import express from "express";
import path from "path";
import fs from "fs";
import os from "os";
import dotenv from "dotenv";
import { GoogleGenAI, Type } from "@google/genai";
import { createServer as createViteServer } from "vite";
import * as XLSX from "xlsx";

dotenv.config();

const app = express();
const PORT = 3000;

// Enable JSON payload parsing with a larger limit for base64 PDFs
app.use(express.json({ limit: "50mb" }));

// State to manage one analysis at a time
let isAnalyzing = false;
let lastCallTimestamp = 0;

// Helper to delay execution
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper to execute API calls with exponential retry
async function callWithRetry<T>(fn: (attempt: number) => Promise<T>, maxRetries = 5, initialDelay = 3000): Promise<T> {
  let retries = 0;
  while (true) {
    try {
      // Enforce the minimum interval before executing the Gemini call
      const now = Date.now();
      const elapsed = now - lastCallTimestamp;
      const minDelay = Number(process.env.GEMINI_MIN_DELAY_MS) || 12000;
      if (elapsed < minDelay) {
        const waitTime = minDelay - elapsed;
        console.log(`[Gemini] Delaying call by ${waitTime}ms to respect GEMINI_MIN_DELAY_MS...`);
        await sleep(waitTime);
      }

      const result = await fn(retries);
      lastCallTimestamp = Date.now();
      return result;
    } catch (error: any) {
      console.error(`[Gemini Error]`, error);
      const errorMsg = String(error.message || error).toUpperCase();
      const status = error.status || (error.error && error.error.code) || 0;

      const isRateLimit =
        errorMsg.includes("429") ||
        errorMsg.includes("RESOURCE_EXHAUSTED") ||
        status === 429;

      const isUnavailable =
        errorMsg.includes("503") ||
        errorMsg.includes("UNAVAILABLE") ||
        errorMsg.includes("HIGH DEMAND") ||
        errorMsg.includes("TEMPORARY") ||
        status === 503;

      const isTransient = isRateLimit || isUnavailable;

      if (isTransient && retries < maxRetries) {
        retries++;
        // Exponential backoff with some random jitter to avoid thundering herd
        const jitter = Math.floor(Math.random() * 1500);
        const delay = (initialDelay * Math.pow(2, retries)) + jitter;
        const typeStr = isRateLimit ? "Limite de Requisições (429)" : "Alta Demanda Temporária (503)";
        console.warn(`[Gemini Transient Error] ${typeStr} detectado. Retentando em ${delay}ms (tentativa ${retries}/${maxRetries})...`);
        await sleep(delay);
      } else {
        throw error;
      }
    }
  }
}

// Instantiate Gemini SDK
const getGeminiClient = (): GoogleGenAI => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not defined in the environment secrets.");
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
};

// Interface for extracted financial data
interface FinancialData {
  AtivoCirculante: number;
  AtivoNaoCirculante: number;
  Estoques: number;
  Disponivel: number;
  Imobilizado: number;
  PassivoCirculante: number;
  PassivoNaoCirculante: number;
  PatrimonioLiquido: number;
  ReceitaBruta: number;
  Deducoes: number;
  ReceitaLiquida: number;
  Custos: number;
  ResultadoBruto: number;
  DespesasOperacionais: number;
  ResultadoOperacional: number;
  ResultadoLiquido: number;
  ContasNaoClassificadas: string[];
  ObservacoesInconsistencias: string;
  ConfiancaExtracao: number;
}

// Deterministic calculations
function calculateIndicators(data: FinancialData) {
  const AtivoTotal = data.AtivoCirculante + data.AtivoNaoCirculante;
  const PassivoTotal = data.PassivoCirculante + data.PassivoNaoCirculante;
  const PassivoTotalEPais = PassivoTotal + data.PatrimonioLiquido;
  const DiferencaBalanco = AtivoTotal - PassivoTotalEPais;
  const BalancoConsistente = Math.abs(DiferencaBalanco) < 10.0; // Margin of 10 BRL

  const LiquidezCorrente = data.PassivoCirculante !== 0 ? data.AtivoCirculante / data.PassivoCirculante : null;
  const LiquidezSeca = data.PassivoCirculante !== 0 ? (data.AtivoCirculante - data.Estoques) / data.PassivoCirculante : null;
  const LiquidezImediata = data.PassivoCirculante !== 0 ? data.Disponivel / data.PassivoCirculante : null;
  const CapitalDeGiro = data.AtivoCirculante - data.PassivoCirculante;
  const Endividamento = AtivoTotal !== 0 ? PassivoTotal / AtivoTotal : null;
  const CapitalDeTerceiros = data.PatrimonioLiquido !== 0 ? PassivoTotal / data.PatrimonioLiquido : null;
  const ImobilizacaoPL = data.PatrimonioLiquido !== 0 ? data.Imobilizado / data.PatrimonioLiquido : null;
  
  const MargemBruta = data.ReceitaLiquida !== 0 ? data.ResultadoBruto / data.ReceitaLiquida : null;
  const MargemOperacional = data.ReceitaLiquida !== 0 ? data.ResultadoOperacional / data.ReceitaLiquida : null;
  const MargemLiquida = data.ReceitaLiquida !== 0 ? data.ResultadoLiquido / data.ReceitaLiquida : null;
  const ROA = AtivoTotal !== 0 ? data.ResultadoLiquido / AtivoTotal : null;
  const ROE = data.PatrimonioLiquido !== 0 ? data.ResultadoLiquido / data.PatrimonioLiquido : null;

  return {
    LiquidezCorrente,
    LiquidezSeca,
    LiquidezImediata,
    CapitalDeGiro,
    Endividamento,
    CapitalDeTerceiros,
    ImobilizacaoPL,
    MargemBruta,
    MargemOperacional,
    MargemLiquida,
    ROA,
    ROE,
    AtivoTotal,
    PassivoTotal,
    PassivoTotalEPais,
    DiferencaBalanco,
    BalancoConsistente
  };
}

// Robust helper function to convert Excel files (.xlsx, .xls) into text-based CSV tables
function parseExcelToText(buffer: Buffer, originalFileName: string): string {
  try {
    console.log(`[Excel Parser] Attempting to read Excel spreadsheet: ${originalFileName}`);
    const workbook = XLSX.read(buffer, { type: "buffer" });
    let textContent = "";
    
    for (const sheetName of workbook.SheetNames) {
      const worksheet = workbook.Sheets[sheetName];
      // Convert worksheet to CSV (using standard csv)
      const csv = XLSX.utils.sheet_to_csv(worksheet);
      if (csv && csv.trim()) {
        textContent += `--- ABA/FOLHA: ${sheetName} ---\n${csv}\n\n`;
      }
    }
    
    if (textContent.trim()) {
      return textContent;
    }
    
    throw new Error("O arquivo Excel lido está vazio ou não possui abas com dados.");
  } catch (excelError: any) {
    console.error(`[Excel Parser] Error parsing with SheetJS for ${originalFileName}:`, excelError);
    
    // Fallback: Some financial systems export plain text (HTML, XML Spreadsheet 2003, TSV/CSV) with a .xls extension
    try {
      // Decode as UTF-8 first
      let possibleText = buffer.toString("utf8");
      
      // Look for a reasonable amount of non-control characters to see if it's text-like
      const isUtf8Text = !/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(possibleText.slice(0, 1000));
      
      if (isUtf8Text && possibleText.trim().length > 0) {
        console.log(`[Excel Parser] Fallback succeeded: Discovered clean UTF-8 text format inside ${originalFileName}.`);
        return possibleText;
      }
      
      // Try decoding as Latin1 (ISO-8859-1 / Windows-1252) which is extremely common in Brazil
      possibleText = buffer.toString("latin1");
      const isLatin1Text = !/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(possibleText.slice(0, 1000));
      if (isLatin1Text && possibleText.trim().length > 0) {
        console.log(`[Excel Parser] Fallback succeeded: Discovered clean Latin-1 text format inside ${originalFileName}.`);
        return possibleText;
      }
    } catch (fallbackError) {
      console.error(`[Excel Parser] Text fallback decoding failed:`, fallbackError);
    }
    
    // If it's a binary file and SheetJS failed, we raise a friendly Portuguese error instead of passing raw excel to Gemini
    throw new Error(
      `Não foi possível processar o arquivo Excel "${originalFileName}". O arquivo pode estar corrompido, protegido por senha, em formato XLS antigo incompatível, ou não conter tabelas legíveis. Por favor, exporte/salve-o como PDF ou TXT (Texto/CSV) e envie novamente.`
    );
  }
}

// Helper to clean up any single raw value string to a standard JSON number.
function cleanValue(valStr: string): string {
  if (!valStr) return "0";
  let cleaned = valStr.trim();
  if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  
  // Remove "R$" and spaces
  cleaned = cleaned.replace(/R\$/gi, "").replace(/\s/g, "");
  
  if (cleaned === "" || cleaned === "-" || cleaned === "null" || cleaned === "undefined") {
    return "0";
  }
  
  // Convert Brazilian decimal/thousands formatting
  if (cleaned.includes(",")) {
    // Dots are thousand separators, comma is decimal
    cleaned = cleaned.replace(/\./g, "").replace(/,/g, ".");
  } else {
    // If there is no comma but multiple dots, e.g. 1.234.567
    const dotCount = (cleaned.match(/\./g) || []).length;
    if (dotCount > 1) {
      cleaned = cleaned.replace(/\./g, "");
    } else if (dotCount === 1) {
      // Single dot: check if it is followed by exactly 3 digits (e.g. 123.456)
      if (/\.\d{3}$/.test(cleaned)) {
        cleaned = cleaned.replace(/\./g, "");
      }
    }
  }
  
  // Validate that the cleaned value is actually a valid number
  if (isNaN(Number(cleaned))) {
    return "0";
  }
  
  return cleaned;
}

// Reconstruct a 100% syntactically valid JSON matching our schema from potentially corrupted text as a fail-safe recovery.
function reconstructFallbackJson(text: string): string {
  console.warn("[Server] Reconstructing fallback JSON from invalid text...");
  const fallbackObj: any = {
    AtivoCirculante: 0,
    AtivoNaoCirculante: 0,
    Estoques: 0,
    Disponivel: 0,
    Imobilizado: 0,
    PassivoCirculante: 0,
    PassivoNaoCirculante: 0,
    PatrimonioLiquido: 0,
    ReceitaBruta: 0,
    Deducoes: 0,
    ReceitaLiquida: 0,
    Custos: 0,
    ResultadoBruto: 0,
    DespesasOperacionais: 0,
    ResultadoOperacional: 0,
    ResultadoLiquido: 0,
    ContasNaoClassificadas: [],
    ObservacoesInconsistencias: "Recuperação automática de falha na estrutura do JSON retornado pelo modelo.",
    ConfiancaExtracao: 50
  };

  const numericKeys = [
    "AtivoCirculante", "AtivoNaoCirculante", "Estoques", "Disponivel", "Imobilizado",
    "PassivoCirculante", "PassivoNaoCirculante", "PatrimonioLiquido", "ReceitaBruta",
    "Deducoes", "ReceitaLiquida", "Custos", "ResultadoBruto", "DespesasOperacionais",
    "ResultadoOperacional", "ResultadoLiquido", "ConfiancaExtracao"
  ];

  for (const key of numericKeys) {
    const keyRegex = new RegExp(`"${key}"\\s*:\\s*(?:"([^"]*)"|([^,\\s}\\]]+))`);
    const match = text.match(keyRegex);
    if (match) {
      const rawVal = match[1] !== undefined ? match[1] : match[2];
      fallbackObj[key] = Number(cleanValue(rawVal));
    }
  }

  // Also try to find ObservacoesInconsistencias
  const obsRegex = /"ObservacoesInconsistencias"\s*:\s*"([^"]*)"/;
  const obsMatch = text.match(obsRegex);
  if (obsMatch) {
    fallbackObj.ObservacoesInconsistencias = obsMatch[1];
  }

  // Also try to find ContasNaoClassificadas list
  const listRegex = /"ContasNaoClassificadas"\s*:\s*\[([\s\S]*?)\]/;
  const listMatch = text.match(listRegex);
  if (listMatch) {
    try {
      const arrText = `[${listMatch[1]}]`;
      fallbackObj.ContasNaoClassificadas = JSON.parse(arrText);
    } catch {
      // If parsing the array fails, try to split by comma manually
      fallbackObj.ContasNaoClassificadas = listMatch[1]
        .split(",")
        .map(x => x.replace(/["'\s[\]]/g, "").trim())
        .filter(x => x.length > 0);
    }
  }

  return JSON.stringify(fallbackObj, null, 2);
}

// Helper to clean up Gemini's raw JSON response, specifically converting any Brazilian formatted numbers
// (with thousands dots and decimal commas) into standard valid JSON number representations.
function cleanFinancialJson(jsonText: string): string {
  // Extract JSON part first (between first '{' and last '}') to strip any markdown fences or surrounding chat noise
  const firstBrace = jsonText.indexOf("{");
  const lastBrace = jsonText.lastIndexOf("}");
  let cleaned = jsonText;
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = jsonText.substring(firstBrace, lastBrace + 1);
  }
  cleaned = cleaned.trim();

  // 1. First, try to parse the JSON directly. If it is already valid, we return it as-is!
  // This is the safest approach and guarantees we don't modify anything unnecessarily.
  try {
    JSON.parse(cleaned);
    return cleaned;
  } catch (directParseError) {
    console.warn("[Server] Direct JSON parse failed, performing robust regex-based values cleaning...", directParseError);
  }

  const numericKeys = [
    "AtivoCirculante", "AtivoNaoCirculante", "Estoques", "Disponivel", "Imobilizado",
    "PassivoCirculante", "PassivoNaoCirculante", "PatrimonioLiquido", "ReceitaBruta",
    "Deducoes", "ReceitaLiquida", "Custos", "ResultadoBruto", "DespesasOperacionais",
    "ResultadoOperacional", "ResultadoLiquido", "ConfiancaExtracao"
  ];

  for (const key of numericKeys) {
    // This regex matches "key" : followed by either:
    // 1. A double-quoted string: "..."
    // 2. Or a sequence of unquoted chars (excluding comma, closing brace, closing bracket)
    const keyRegex = new RegExp(`("${key}"\\s*:\\s*)(?:"([^"]*)"|([^,\\s}\\]]+))`, "g");
    
    cleaned = cleaned.replace(keyRegex, (match, prefix, quotedVal, unquotedVal) => {
      const rawVal = quotedVal !== undefined ? quotedVal : unquotedVal;
      const cleanedVal = cleanValue(rawVal);
      return `${prefix}${cleanedVal}`;
    });
  }

  // Double check if there are any trailing commas before a closing brace/bracket, which is invalid in standard JSON
  cleaned = cleaned.replace(/,\s*([}\]])/g, "$1");

  try {
    JSON.parse(cleaned);
    return cleaned;
  } catch (secondaryParseError: any) {
    console.error("[Server] Cleaned JSON still invalid! Raw error:", secondaryParseError.message);
    return reconstructFallbackJson(cleaned);
  }
}

// API Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "healthy", timestamp: new Date().toISOString() });
});

// Primary analysis endpoint
app.post("/api/analyze", async (req, res) => {
  const { 
    companyName, 
    period, 
    fileBase64, 
    fileName,
    fileBase64Prev,
    fileNamePrev,
    periodPrev
  } = req.body;

  if (!fileBase64) {
    return res.status(400).json({ error: "O arquivo do balancete atual é obrigatório." });
  }

  // Enforce processing one PDF at a time
  if (isAnalyzing) {
    return res.status(429).json({
      error: "O servidor está processando outra análise no momento. Por favor, aguarde alguns instantes e tente novamente.",
    });
  }

  isAnalyzing = true;
  let tempFilePath = "";
  let tempFilePathPrev = "";
  let uploadedFileRef: any = null;
  let uploadedFileRefPrev: any = null;
  const ai = getGeminiClient();

  try {
    const modelName = process.env.GEMINI_MODEL || "gemini-3.5-flash";
    const maxTokens = Number(process.env.GEMINI_MAX_OUTPUT_TOKENS) || 4000;

    // Determine MIME type for main file
    const ext = path.extname(fileName || "").toLowerCase();
    let mimeType = "application/pdf";
    if (ext === ".xlsx") {
      mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    } else if (ext === ".xls") {
      mimeType = "application/vnd.ms-excel";
    } else if (ext === ".txt") {
      mimeType = "text/plain";
    }

    // 1. Create a local temporary file for main period
    const buffer = Buffer.from(fileBase64, "base64");
    tempFilePath = path.join(os.tmpdir(), `balancete_${Date.now()}_${fileName || "document.pdf"}`);
    fs.writeFileSync(tempFilePath, buffer);
    console.log(`[Server] Temporary file saved to: ${tempFilePath} (MIME: ${mimeType})`);

    let uploadFilePath = tempFilePath;
    let uploadMimeType = mimeType;

    if (ext === ".xlsx" || ext === ".xls") {
      console.log(`[Server] Parsing main Excel file using helper: ${fileName}`);
      const textContent = parseExcelToText(buffer, fileName || "document.xls");
      const txtPath = tempFilePath + ".txt";
      fs.writeFileSync(txtPath, textContent, "utf8");
      uploadFilePath = txtPath;
      uploadMimeType = "text/plain";
      console.log(`[Server] Main Excel converted to CSV text file: ${txtPath}`);
    }

    // 2. Upload the file using the Files API
    console.log(`[Server] Uploading main file to Gemini Files API...`);
    uploadedFileRef = await ai.files.upload({
      file: uploadFilePath,
      config: {
        mimeType: uploadMimeType,
      },
    });
    console.log(`[Server] File uploaded successfully to Gemini. Ref Name: ${uploadedFileRef.name}`);

    // Define account extraction schema
    const schema = {
      type: Type.OBJECT,
      properties: {
        AtivoCirculante: { type: Type.NUMBER, description: "Valor do Ativo Circulante (ou saldo final) em Reais. Deve ser zero ou positivo." },
        AtivoNaoCirculante: { type: Type.NUMBER, description: "Valor do Ativo Não Circulante em Reais. Deve ser zero ou positivo." },
        Estoques: { type: Type.NUMBER, description: "Valor total da conta de Estoques / Almoxarifado contido no Ativo Circulante em Reais." },
        Disponivel: { type: Type.NUMBER, description: "Disponibilidades, Caixa e Equivalentes de Caixa ou Bancos contido no Ativo Circulante em Reais." },
        Imobilizado: { type: Type.NUMBER, description: "Ativo Imobilizado contido no Ativo Não Circulante em Reais." },
        PassivoCirculante: { type: Type.NUMBER, description: "Valor total do Passivo Circulante em Reais." },
        PassivoNaoCirculante: { type: Type.NUMBER, description: "Valor total do Passivo Não Circulante (Exigível a Longo Prazo) em Reais." },
        PatrimonioLiquido: { type: Type.NUMBER, description: "Valor total do Patrimônio Líquido (PL) em Reais." },
        ReceitaBruta: { type: Type.NUMBER, description: "Valor total da Receita Operacional Bruta em Reais." },
        Deducoes: { type: Type.NUMBER, description: "Valor de deduções, devoluções e impostos sobre vendas em Reais. Se for redutor/negativo, extrair como positivo para a dedução." },
        ReceitaLiquida: { type: Type.NUMBER, description: "Valor da Receita Líquida em Reais (Receita Bruta - Deduções)." },
        Custos: { type: Type.NUMBER, description: "Custos dos Produtos Vendidos (CPV), Custos das Mercadorias Vendidas (CMV) ou Custos dos Serviços Prestados (CSP) em Reais. Extrair como valor absoluto positivo." },
        ResultadoBruto: { type: Type.NUMBER, description: "Lucro ou Resultado Bruto em Reais (Receita Líquida - Custos)." },
        DespesasOperacionais: { type: Type.NUMBER, description: "Soma total de despesas operacionais (Administrativas, Vendas, Tributárias, etc.) em Reais." },
        ResultadoOperacional: { type: Type.NUMBER, description: "EBIT, Lucro ou Resultado Operacional em Reais." },
        ResultadoLiquido: { type: Type.NUMBER, description: "Lucro ou Prejuízo Líquido final do período em Reais." },
        ContasNaoClassificadas: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: "Nomes de contas importantes ou volumosas que não puderam ser enquadradas perfeitamente nos grandes grupos contábeis acima.",
        },
        ObservacoesInconsistencias: {
          type: Type.STRING,
          description: "Descrever observações, baixa legibilidade, valores ausentes, ou inconsistências identificadas de forma objetiva.",
        },
        ConfiancaExtracao: {
          type: Type.INTEGER,
          description: "Grau de confiança estimado na extração de 0 (nula) a 100 (totalmente precisa) baseando-se na legibilidade do balancete.",
        },
      },
      required: [
        "AtivoCirculante",
        "AtivoNaoCirculante",
        "Estoques",
        "Disponivel",
        "Imobilizado",
        "PassivoCirculante",
        "PassivoNaoCirculante",
        "PatrimonioLiquido",
        "ReceitaBruta",
        "Deducoes",
        "ReceitaLiquida",
        "Custos",
        "ResultadoBruto",
        "DespesasOperacionais",
        "ResultadoOperacional",
        "ResultadoLiquido",
        "ContasNaoClassificadas",
        "ObservacoesInconsistencias",
        "ConfiancaExtracao",
      ],
    };

    const promptExtracao = `Você é um robô de extração contábil altamente qualificado. 
Sua tarefa é analisar o balancete/documento anexado para a empresa "${companyName || "não especificada"}" no período "${period || "não especificado"}" e extrair exatamente os valores das contas principais descritos no esquema.

Instruções cruciais:
1. Se houver contas redutoras como Custos ou Despesas apresentadas com sinal de menos no documento, extraia os valores em formato POSITIVO (valores absolutos), pois os cálculos determinísticos serão feitos pelo sistema posteriormente.
2. Não invente NENHUM valor se ele não estiver explicitamente presente ou se for impossível inferir de forma consistente. Se o arquivo for ilegível, incompleto ou inconsistente, atribua 0 e relate nas observações 'ObservacoesInconsistencias'.
3. O balancete contém contas de Balanço Patrimonial e Demonstração de Resultado do Exercício (DRE). Leia atentamente os saldos finais das contas.
4. IMPORTANTE: Todos os números no JSON resultante devem ser estritamente numéricos válidos para JSON (apenas dígitos, sem pontos separadores de milhar e com ponto '.' como o único separador decimal, por exemplo: 1250000.50). Nunca envie números formatados com vírgula ou pontos múltiplos.`;

    // 3. First call to Gemini: Extract JSON Structured Data for main period
    console.log(`[Server] Initiating Step 1: Account extraction for main period with model ${modelName}...`);
    const extractionResult = await callWithRetry(async (attempt) => {
      const modelToUse = attempt > 0 ? "gemini-2.5-flash" : modelName;
      console.log(`[Server] Step 1 Account extraction: Using model ${modelToUse} (attempt ${attempt + 1})`);
      const response = await ai.models.generateContent({
        model: modelToUse,
        contents: [
          {
            fileData: {
              fileUri: uploadedFileRef.uri,
              mimeType: uploadedFileRef.mimeType || uploadMimeType,
            },
          },
          promptExtracao,
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: schema,
          maxOutputTokens: maxTokens,
          temperature: 0.1,
        },
      });
      return response;
    });

    const extractionText = extractionResult.text || "{}";
    console.log(`[Server] Raw JSON Extracted (Main):`, extractionText);
    const cleanedJson = cleanFinancialJson(extractionText);
    console.log(`[Server] Cleaned JSON (Main):`, cleanedJson);
    const extractedData: FinancialData = JSON.parse(cleanedJson);

    // Detect if balances are in millions
    const initialAtivoTotal = extractedData.AtivoCirculante + extractedData.AtivoNaoCirculante;
    const isMillions = Math.max(
      Math.abs(initialAtivoTotal),
      Math.abs(extractedData.ReceitaLiquida),
      Math.abs(extractedData.ReceitaBruta)
    ) >= 1000000;

    let finalExtractedData = { ...extractedData };
    if (isMillions) {
      console.log(`[Server] Detected balances in millions! Converting to thousands (Reais Mil)...`);
      const keysToDivide = [
        "AtivoCirculante",
        "AtivoNaoCirculante",
        "Estoques",
        "Disponivel",
        "Imobilizado",
        "PassivoCirculante",
        "PassivoNaoCirculante",
        "PatrimonioLiquido",
        "ReceitaBruta",
        "Deducoes",
        "ReceitaLiquida",
        "Custos",
        "ResultadoBruto",
        "DespesasOperacionais",
        "ResultadoOperacional",
        "ResultadoLiquido"
      ] as const;

      for (const key of keysToDivide) {
        if (typeof finalExtractedData[key] === "number") {
          finalExtractedData[key] = Math.round(finalExtractedData[key] / 1000);
        }
      }
    }

    // 4. Perform the deterministic mathematical calculations for main period
    console.log(`[Server] Calculating indicators deterministically for main period in JavaScript...`);
    const indicators = calculateIndicators(finalExtractedData);

    // 5. Optional previous period extraction
    let finalExtractedDataPrev: any = null;
    let indicatorsPrev: any = null;

    if (fileBase64Prev) {
      const extPrev = path.extname(fileNamePrev || "").toLowerCase();
      let mimeTypePrev = "application/pdf";
      if (extPrev === ".xlsx") {
        mimeTypePrev = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      } else if (extPrev === ".xls") {
        mimeTypePrev = "application/vnd.ms-excel";
      } else if (extPrev === ".txt") {
        mimeTypePrev = "text/plain";
      }

      const bufferPrev = Buffer.from(fileBase64Prev, "base64");
      tempFilePathPrev = path.join(os.tmpdir(), `balancete_prev_${Date.now()}_${fileNamePrev || "document_prev.pdf"}`);
      fs.writeFileSync(tempFilePathPrev, bufferPrev);
      console.log(`[Server] Temporary previous file saved to: ${tempFilePathPrev} (MIME: ${mimeTypePrev})`);

      let uploadFilePathPrev = tempFilePathPrev;
      let uploadMimeTypePrev = mimeTypePrev;

      if (extPrev === ".xlsx" || extPrev === ".xls") {
        console.log(`[Server] Parsing previous Excel file using helper: ${fileNamePrev}`);
        const textContentPrev = parseExcelToText(bufferPrev, fileNamePrev || "document_prev.xls");
        const txtPathPrev = tempFilePathPrev + ".txt";
        fs.writeFileSync(txtPathPrev, textContentPrev, "utf8");
        uploadFilePathPrev = txtPathPrev;
        uploadMimeTypePrev = "text/plain";
        console.log(`[Server] Previous Excel converted to CSV text file: ${txtPathPrev}`);
      }

      console.log(`[Server] Uploading previous file to Gemini Files API...`);
      uploadedFileRefPrev = await ai.files.upload({
        file: uploadFilePathPrev,
        config: {
          mimeType: uploadMimeTypePrev,
        },
      });
      console.log(`[Server] Previous file uploaded successfully to Gemini. Ref Name: ${uploadedFileRefPrev.name}`);

      const promptExtracaoPrev = `Você é um robô de extração contábil altamente qualificado. 
Sua tarefa é analisar o balancete/documento anexado para a empresa "${companyName || "não especificada"}" no período ANTERIOR "${periodPrev || "não especificado"}" e extrair exatamente os valores das contas principais descritos no esquema.

Instruções cruciais:
1. Se houver contas redutoras como Custos ou Despesas apresentadas com sinal de menos no documento, extraia os valores em formato POSITIVO (valores absolutos), pois os cálculos serão feitos pelo sistema posteriormente.
2. Não invente NENHUM valor se ele não estiver explicitamente presente ou se for impossível inferir de forma consistente. Se o arquivo for ilegível, incompleto ou inconsistente, atribua 0 e relate nas observações 'ObservacoesInconsistencias'.
3. O balancete contém contas de Balanço Patrimonial e Demonstração de Resultado do Exercício (DRE). Leia atentamente os saldos finais das contas.
4. IMPORTANTE: Todos os números no JSON resultante devem ser estritamente numéricos válidos para JSON (apenas dígitos, sem pontos separadores de milhar e com ponto '.' como o único separador decimal, por exemplo: 1250000.50). Nunca envie números formatados com vírgula ou pontos múltiplos.`;

      console.log(`[Server] Initiating previous period extraction with model ${modelName}...`);
      const extractionResultPrev = await callWithRetry(async (attempt) => {
        const modelToUse = attempt > 0 ? "gemini-2.5-flash" : modelName;
        console.log(`[Server] Step 2 Previous period extraction: Using model ${modelToUse} (attempt ${attempt + 1})`);
        return await ai.models.generateContent({
          model: modelToUse,
          contents: [
            {
              fileData: {
                fileUri: uploadedFileRefPrev.uri,
                mimeType: uploadedFileRefPrev.mimeType || uploadMimeTypePrev,
              },
            },
            promptExtracaoPrev,
          ],
          config: {
            responseMimeType: "application/json",
            responseSchema: schema,
            maxOutputTokens: maxTokens,
            temperature: 0.1,
          },
        });
      });

      const extractionTextPrev = extractionResultPrev.text || "{}";
      console.log(`[Server] Raw JSON Extracted (Prev):`, extractionTextPrev);
      const cleanedJsonPrev = cleanFinancialJson(extractionTextPrev);
      console.log(`[Server] Cleaned JSON (Prev):`, cleanedJsonPrev);
      const extractedDataPrev: FinancialData = JSON.parse(cleanedJsonPrev);

      finalExtractedDataPrev = { ...extractedDataPrev };
      if (isMillions) {
        console.log(`[Server] Detected balances in millions! Converting previous period to thousands (Reais Mil)...`);
        const keysToDivide = [
          "AtivoCirculante",
          "AtivoNaoCirculante",
          "Estoques",
          "Disponivel",
          "Imobilizado",
          "PassivoCirculante",
          "PassivoNaoCirculante",
          "PatrimonioLiquido",
          "ReceitaBruta",
          "Deducoes",
          "ReceitaLiquida",
          "Custos",
          "ResultadoBruto",
          "DespesasOperacionais",
          "ResultadoOperacional",
          "ResultadoLiquido"
        ] as const;

        for (const key of keysToDivide) {
          if (typeof finalExtractedDataPrev[key] === "number") {
            finalExtractedDataPrev[key] = Math.round(finalExtractedDataPrev[key] / 1000);
          }
        }
      }

      console.log(`[Server] Calculating indicators deterministically for previous period...`);
      indicatorsPrev = calculateIndicators(finalExtractedDataPrev);
    }

    const formatPromptValue = (val: number) => {
      if (isMillions) {
        return `R$ ${val.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} (Reais Mil)`;
      } else {
        return `R$ ${val.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      }
    };

    // 6. Generate Executive Report
    console.log(`[Server] Initiating Step 2: Report Generation...`);
    
    let promptRelatorio = `Você é um Analista Financeiro Sênior especializado em reestruturação e mentoria de pequenas e médias empresas brasileiras.
Sua missão é redigir um memorando executivo de alta qualidade técnica, mas com linguagem extremamente clara, didática e acessível para o proprietário da empresa.

Empresa: ${companyName || "Não Informada"}
`;

    if (finalExtractedDataPrev && indicatorsPrev) {
      promptRelatorio += `
**ESTE RELATÓRIO É UMA ANÁLISE COMPARATIVA ENTRE DOIS PERÍODOS!**
Período Atual Analisado: ${period || "Não Informado"}
Período Anterior para Comparação: ${periodPrev || "Não Informado"}

Você DEVE fazer uma análise horizontal comparando os dois períodos, identificando variações percentuais e nominais, tendências de melhoria ou deterioração nas contas e nos indicadores.

DADOS DO PERÍODO ATUAL (${period}):
- Ativo Circulante: ${formatPromptValue(finalExtractedData.AtivoCirculante)}
- Ativo Não Circulante: ${formatPromptValue(finalExtractedData.AtivoNaoCirculante)}
  - Estoques: ${formatPromptValue(finalExtractedData.Estoques)}
  - Disponível: ${formatPromptValue(finalExtractedData.Disponivel)}
  - Imobilizado: ${formatPromptValue(finalExtractedData.Imobilizado)}
- Ativo Total: ${formatPromptValue(indicators.AtivoTotal)}

- Passivo Circulante: ${formatPromptValue(finalExtractedData.PassivoCirculante)}
- Passivo Não Circulante: ${formatPromptValue(finalExtractedData.PassivoNaoCirculante)}
- Patrimônio Líquido: ${formatPromptValue(finalExtractedData.PatrimonioLiquido)}
- Passivo Total + PL: ${formatPromptValue(indicators.PassivoTotalEPais)}
- Diferença de Fechamento do Balanço: ${formatPromptValue(indicators.DiferencaBalanco)} (${indicators.BalancoConsistente ? "BALANÇO CONSISTENTE" : "Ressalva: Balanço inconsistente ou com diferença"})

- Receita Bruta: ${formatPromptValue(finalExtractedData.ReceitaBruta)}
- Deduções: ${formatPromptValue(finalExtractedData.Deducoes)}
- Receita Líquida: ${formatPromptValue(finalExtractedData.ReceitaLiquida)}
- Custos: ${formatPromptValue(finalExtractedData.Custos)}
- Resultado Bruto: ${formatPromptValue(finalExtractedData.ResultadoBruto)}
- Despesas Operacionais: ${formatPromptValue(finalExtractedData.DespesasOperacionais)}
- Resultado Operacional (EBIT): ${formatPromptValue(finalExtractedData.ResultadoOperacional)}
- Resultado Líquido: ${formatPromptValue(finalExtractedData.ResultadoLiquido)}

Indicadores Calculados para o Período Atual (${period}):
- Liquidez Corrente: ${indicators.LiquidezCorrente !== null ? indicators.LiquidezCorrente.toFixed(2) : "N/A"}
- Liquidez Seca: ${indicators.LiquidezSeca !== null ? indicators.LiquidezSeca.toFixed(2) : "N/A"}
- Liquidez Imediata: ${indicators.LiquidezImediata !== null ? indicators.LiquidezImediata.toFixed(2) : "N/A"}
- Capital de Giro Líquido: ${formatPromptValue(indicators.CapitalDeGiro)}
- Endividamento Geral: ${indicators.Endividamento !== null ? (indicators.Endividamento * 100).toFixed(1) + "%" : "N/A"}
- Capital de Terceiros / PL: ${indicators.CapitalDeTerceiros !== null ? (indicators.CapitalDeTerceiros * 100).toFixed(1) + "%" : "N/A"}
- Imobilização do PL: ${indicators.ImobilizacaoPL !== null ? (indicators.ImobilizacaoPL * 100).toFixed(1) + "%" : "N/A"}
- Margem Bruta: ${indicators.MargemBruta !== null ? (indicators.MargemBruta * 100).toFixed(1) + "%" : "N/A"}
- Margem Operacional: ${indicators.MargemOperacional !== null ? (indicators.MargemOperacional * 100).toFixed(1) + "%" : "N/A"}
- Margem Líquida: ${indicators.MargemLiquida !== null ? (indicators.MargemLiquida * 100).toFixed(1) + "%" : "N/A"}
- Retorno sobre Ativos (ROA): ${indicators.ROA !== null ? (indicators.ROA * 100).toFixed(1) + "%" : "N/A"}
- Retorno sobre PL (ROE): ${indicators.ROE !== null ? (indicators.ROE * 100).toFixed(1) + "%" : "N/A"}


DADOS DO PERÍODO ANTERIOR (${periodPrev}):
- Ativo Circulante: ${formatPromptValue(finalExtractedDataPrev.AtivoCirculante)}
- Ativo Não Circulante: ${formatPromptValue(finalExtractedDataPrev.AtivoNaoCirculante)}
  - Estoques: ${formatPromptValue(finalExtractedDataPrev.Estoques)}
  - Disponível: ${formatPromptValue(finalExtractedDataPrev.Disponivel)}
  - Imobilizado: ${formatPromptValue(finalExtractedDataPrev.Imobilizado)}
- Ativo Total: ${formatPromptValue(indicatorsPrev.AtivoTotal)}

- Passivo Circulante: ${formatPromptValue(finalExtractedDataPrev.PassivoCirculante)}
- Passivo Não Circulante: ${formatPromptValue(finalExtractedDataPrev.PassivoNaoCirculante)}
- Patrimônio Líquido: ${formatPromptValue(finalExtractedDataPrev.PatrimonioLiquido)}
- Passivo Total + PL: ${formatPromptValue(indicatorsPrev.PassivoTotalEPais)}
- Diferença de Fechamento do Balanço: ${formatPromptValue(indicatorsPrev.DiferencaBalanco)} (${indicatorsPrev.BalancoConsistente ? "BALANÇO CONSISTENTE" : "Ressalva: Balanço inconsistente ou com diferença"})

- Receita Bruta: ${formatPromptValue(finalExtractedDataPrev.ReceitaBruta)}
- Deduções: ${formatPromptValue(finalExtractedDataPrev.Deducoes)}
- Receita Líquida: ${formatPromptValue(finalExtractedDataPrev.ReceitaLiquida)}
- Custos: ${formatPromptValue(finalExtractedDataPrev.Custos)}
- Resultado Bruto: ${formatPromptValue(finalExtractedDataPrev.ResultadoBruto)}
- Despesas Operacionais: ${formatPromptValue(finalExtractedDataPrev.DespesasOperacionais)}
- Resultado Operacional (EBIT): ${formatPromptValue(finalExtractedDataPrev.ResultadoOperacional)}
- Resultado Líquido: ${formatPromptValue(finalExtractedDataPrev.ResultadoLiquido)}

Indicadores Calculados para o Período Anterior (${periodPrev}):
- Liquidez Corrente: ${indicatorsPrev.LiquidezCorrente !== null ? indicatorsPrev.LiquidezCorrente.toFixed(2) : "N/A"}
- Liquidez Seca: ${indicatorsPrev.LiquidezSeca !== null ? indicatorsPrev.LiquidezSeca.toFixed(2) : "N/A"}
- Liquidez Imediata: ${indicatorsPrev.LiquidezImediata !== null ? indicatorsPrev.LiquidezImediata.toFixed(2) : "N/A"}
- Capital de Giro Líquido: ${formatPromptValue(indicatorsPrev.CapitalDeGiro)}
- Endividamento Geral: ${indicatorsPrev.Endividamento !== null ? (indicatorsPrev.Endividamento * 100).toFixed(1) + "%" : "N/A"}
- Capital de Terceiros / PL: ${indicatorsPrev.CapitalDeTerceiros !== null ? (indicatorsPrev.CapitalDeTerceiros * 100).toFixed(1) + "%" : "N/A"}
- Imobilização do PL: ${indicatorsPrev.ImobilizacaoPL !== null ? (indicatorsPrev.ImobilizacaoPL * 100).toFixed(1) + "%" : "N/A"}
- Margem Bruta: ${indicatorsPrev.MargemBruta !== null ? (indicatorsPrev.MargemBruta * 100).toFixed(1) + "%" : "N/A"}
- Margem Operacional: ${indicatorsPrev.MargemOperacional !== null ? (indicatorsPrev.MargemOperacional * 100).toFixed(1) + "%" : "N/A"}
- Margem Líquida: ${indicatorsPrev.MargemLiquida !== null ? (indicatorsPrev.MargemLiquida * 100).toFixed(1) + "%" : "N/A"}
- Retorno sobre Ativos (ROA): ${indicatorsPrev.ROA !== null ? (indicatorsPrev.ROA * 100).toFixed(1) + "%" : "N/A"}
- Retorno sobre PL (ROE): ${indicatorsPrev.ROE !== null ? (indicatorsPrev.ROE * 100).toFixed(1) + "%" : "N/A"}
`;
    } else {
      promptRelatorio += `
Período analisado: ${period || "Não Informado"}

Dados Contábeis Extraídos do Balancete:
- Ativo Circulante: ${formatPromptValue(finalExtractedData.AtivoCirculante)}
- Ativo Não Circulante: ${formatPromptValue(finalExtractedData.AtivoNaoCirculante)}
  - Estoques: ${formatPromptValue(finalExtractedData.Estoques)}
  - Disponível: ${formatPromptValue(finalExtractedData.Disponivel)}
  - Imobilizado: ${formatPromptValue(finalExtractedData.Imobilizado)}
- Ativo Total: ${formatPromptValue(indicators.AtivoTotal)}

- Passivo Circulante: ${formatPromptValue(finalExtractedData.PassivoCirculante)}
- Passivo Não Circulante: ${formatPromptValue(finalExtractedData.PassivoNaoCirculante)}
- Patrimônio Líquido: ${formatPromptValue(finalExtractedData.PatrimonioLiquido)}
- Passivo Total + PL: ${formatPromptValue(indicators.PassivoTotalEPais)}
- Diferença de Fechamento do Balanço: ${formatPromptValue(indicators.DiferencaBalanco)} (${indicators.BalancoConsistente ? "BALANÇO CONSISTENTE" : "Ressalva: Balanço inconsistente ou com diferença relevante"})

- Receita Bruta: ${formatPromptValue(finalExtractedData.ReceitaBruta)}
- Deduções: ${formatPromptValue(finalExtractedData.Deducoes)}
- Receita Líquida: ${formatPromptValue(finalExtractedData.ReceitaLiquida)}
- Custos: ${formatPromptValue(finalExtractedData.Custos)}
- Resultado Bruto: ${formatPromptValue(finalExtractedData.ResultadoBruto)}
- Despesas Operacionais: ${formatPromptValue(finalExtractedData.DespesasOperacionais)}
- Resultado Operacional (EBIT): ${formatPromptValue(finalExtractedData.ResultadoOperacional)}
- Resultado Líquido: ${formatPromptValue(finalExtractedData.ResultadoLiquido)}

Indicadores de Desempenho Calculados:
- Liquidez Corrente: ${indicators.LiquidezCorrente !== null ? indicators.LiquidezCorrente.toFixed(2) : "N/A"}
- Liquidez Seca: ${indicators.LiquidezSeca !== null ? indicators.LiquidezSeca.toFixed(2) : "N/A"}
- Liquidez Imediata: ${indicators.LiquidezImediata !== null ? indicators.LiquidezImediata.toFixed(2) : "N/A"}
- Capital de Giro Líquido: ${formatPromptValue(indicators.CapitalDeGiro)}
- Endividamento Geral: ${indicators.Endividamento !== null ? (indicators.Endividamento * 100).toFixed(1) + "%" : "N/A"}
- Capital de Terceiros / PL: ${indicators.CapitalDeTerceiros !== null ? (indicators.CapitalDeTerceiros * 100).toFixed(1) + "%" : "N/A"}
- Imobilização do PL: ${indicators.ImobilizacaoPL !== null ? (indicators.ImobilizacaoPL * 100).toFixed(1) + "%" : "N/A"}
- Margem Bruta: ${indicators.MargemBruta !== null ? (indicators.MargemBruta * 100).toFixed(1) + "%" : "N/A"}
- Margem Operacional: ${indicators.MargemOperacional !== null ? (indicators.MargemOperacional * 100).toFixed(1) + "%" : "N/A"}
- Margem Líquida: ${indicators.MargemLiquida !== null ? (indicators.MargemLiquida * 100).toFixed(1) + "%" : "N/A"}
- Retorno sobre Ativos (ROA): ${indicators.ROA !== null ? (indicators.ROA * 100).toFixed(1) + "%" : "N/A"}
- Retorno sobre PL (ROE): ${indicators.ROE !== null ? (indicators.ROE * 100).toFixed(1) + "%" : "N/A"}
`;
    }

    promptRelatorio += `
Sua tarefa é escrever um memorando em Markdown formatado de forma impecável, estruturado exatamente em 10 seções claras marcadas com títulos de nível 2 (##):

**REQUISITO CRUCIAL E OBRIGATÓRIO (Significado dos Indicadores):**
Em cada indicador contido ou analisado no relatório (especialmente na seção 6), você DEVE explicar de forma didática o que significa conceitualmente, por que ele é útil e como deve ser interpretado pelo proprietário.
Você DEVE definir claramente os seguintes conceitos e indicadores:
- **Liquidez Corrente**: Capacidade de quitar dívidas de curto prazo usando recursos realizáveis de curto prazo.
- **Liquidez Seca**: Capacidade de pagamento de curto prazo excluindo os estoques (que são menos líquidos).
- **Liquidez Imediata**: Capacidade de pagar as contas imediatamente usando apenas o caixa disponível (dinheiro e bancos).
- **Endividamento Geral**: A proporção dos ativos totais financiada por capital de terceiros.
- **EBITDA / IBTDA (Lajida)**: Lucro antes de juros, impostos, depreciação e amortização. Explique que este é o principal indicador de geração de caixa operacional da empresa, indicando a eficiência de sua atividade-fim antes de custos financeiros e impostos. (Nota: Se a depreciação e amortização não estiverem explícitas no balancete, indique que o Resultado Operacional foi usado como base/aproximação conceitual, mas explique detalhadamente seu significado e relevância para o empresário).
- **ROI / ROA (Retorno sobre o Investimento/Ativo)**: Eficiência da empresa em gerar lucro a partir de todos os ativos sob sua gestão.
- **ROE (Retorno sobre o PL)**: Rentabilidade obtida pelos sócios sobre o capital próprio investido.

${isMillions ? `\n**ATENÇÃO CRUCIAL PARA A APRESENTAÇÃO DOS SALDOS:** 
Os saldos contábeis desta empresa estão originalmente na casa dos milhões de reais. Para facilitar a leitura, o proprietário solicitou que toda a análise, os dados contábeis apresentados e as fórmulas conceituais com substituição de valores sejam expressos em **milhares de reais (Reais Mil) sem centavos/vírgula**.
Por exemplo, apresente os valores como "R$ 1.500" para representar 1.500 milhares (ou seja, R$ 1.500.000). Nunca use dízimas ou centavos (,00 ou ,50) para os valores absolutos das contas em milhares. 
Portanto, em todo o memorando, ao apresentar valores de Ativo, Passivo, DRE, etc., apresente-os nesse formato "Reais Mil" (ex: "R$ 1.500" ou "R$ 1.500 Mil" ou simplesmente "R$ 1.500"). As fórmulas conceituais e substituições em '6. Indicadores Econômico-Financeiros detalhados' devem fazer as substituições usando estritamente os valores em milhares de reais (por exemplo, ao invés de 1.500.000 / 1.000.000, escreva 1.500 / 1.000 = 1,50).` : ""}

## 1. Confirmação dos Dados Lidos
Apresente de forma elegante os valores principais lidos e a confiabilidade dos dados para o(s) período(s) (confiança e inconsistências, validando se o Ativo = Passivo + PL. Se houver diferença relevante ou observações, aponte logo aqui de forma explícita).

## 2. Resumo Executivo
Uma visão panorâmica sobre a saúde da empresa para o proprietário. Se houver dois períodos, sintetize as principais evoluções gerais ocorridas.

## 3. Principais Destaques
Identifique os 3 a 5 pontos mais positivos ou preocupantes encontrados na análise contábil.

## 4. Análise Horizontal
Avalie a variação das contas em relação aos grupos principais e a evolução implícita. Se houver dois períodos, apresente uma tabela estruturada contendo a variação nominal e percentual das principais contas entre os períodos.

## 5. Análise Vertical
Indique as proporções principais para o(s) período(s). Por exemplo, custos sobre receita líquida, despesas operacionais sobre receita líquida, participação do ativo circulante no ativo total, etc.

## 6. Indicadores Econômico-Financeiros detalhados
Para os indicadores exigidos (Liquidez Corrente, Seca, Imediata, Capital de Giro, Endividamento, Capital de Terceiros, Imobilização do PL, Margens Bruta, Operacional e Líquida, ROA e ROE): apresente o significado de cada indicador de forma didática, sua fórmula conceitual, a substituição numérica real baseada nos dados contidos acima (se houver dois períodos, apresente lado a lado ou compare-os), o resultado obtido e uma breve interpretação de mercado sobre o número, facilitando a compreensão do proprietário. Certifique-se de incluir definições claras de EBITDA / IBTDA, ROI, ROE, Liquidez Seca, Liquidez Corrente e Endividamento.

## 7. Diagnóstico Financeiro
Diga se a empresa está líquida, se está rentável, e se a estrutura de capital é saudável ou arriscada.

## 8. Mapa de Riscos
Mapeie e classifique os riscos específicos enfrentados pela empresa. Para cada categoria (Liquidez, Endividamento, Operacional, Patrimonial, Rentabilidade), atribua uma classificação explícita de risco (Crítico, Relevante, Moderado, Baixo) e explique o porquê.

## 9. Conclusão Executiva
Responda diretamente, de forma sequencial ou textual, a estas 5 perguntas fundamentais para o tomador de decisão:
1. Qual é a situação financeira atual da empresa?
2. Qual é o principal problema estrutural identificado?
3. Qual é o principal risco que a empresa corre se nada for feito?
4. Qual é a prioridade número um de correção?
5. Qual é a trajetória futura esperada caso as ações corretivas sejam tomadas com sucesso?

## 10. Informações Adicionais Recomendadas
Recomende outros documentos auxiliares importantes que o empresário deve levantar (como fluxo de caixa real, conciliação bancária, controle de estoque, etc.) para complementar este relatório contábil.

Regras importantes de redação:
- Use tom profissional, empático, didático e estratégico.
- Use exclusivamente dados e cálculos fornecidos acima. Não invente números inexistentes.
- Use formatação Markdown rica (tabelas, listas estruturadas, negritos) para máxima legibilidade.
- Escreva integralmente em português do Brasil (pt-BR).`;

    const reportResult = await callWithRetry(async (attempt) => {
      const modelToUse = attempt > 0 ? "gemini-2.5-flash" : modelName;
      console.log(`[Server] Step 3 Executive report generation: Using model ${modelToUse} (attempt ${attempt + 1})`);
      const response = await ai.models.generateContent({
        model: modelToUse,
        contents: promptRelatorio,
        config: {
          maxOutputTokens: maxTokens,
          temperature: 0.2,
        },
      });
      return response;
    });

    const reportMarkdown = reportResult.text || "Erro ao gerar o relatório executivo.";

    // 7. Return both raw extracted, calculated indicators and executive report to client
    res.json({
      success: true,
      companyName: companyName || "Empresa não informada",
      period: period || "Período não informado",
      extractedData: finalExtractedData,
      indicators,
      reportMarkdown,
      isMillions,
      hasPrevious: !!finalExtractedDataPrev,
      periodPrev: periodPrev || "Período anterior não informado",
      extractedDataPrev: finalExtractedDataPrev,
      indicatorsPrev: indicatorsPrev,
    });

  } catch (error: any) {
    console.error("[Server Error] Analysis failed:", error);
    const errorMsg = String(error.message || error).toUpperCase();
    const status = error.status || (error.error && error.error.code) || 0;

    if (
      errorMsg.includes("503") ||
      errorMsg.includes("UNAVAILABLE") ||
      errorMsg.includes("HIGH DEMAND") ||
      errorMsg.includes("TEMPORARY") ||
      status === 503
    ) {
      res.status(503).json({
        error: "O modelo de inteligência artificial do Google (Gemini) está passando por um pico temporário de altíssima demanda global (Erro 503). Como as requisições estão sobrecarregadas no momento, por favor aguarde de 30 a 60 segundos e clique em analisar novamente.",
      });
    } else if (
      errorMsg.includes("429") ||
      errorMsg.includes("RESOURCE_EXHAUSTED") ||
      status === 429
    ) {
      res.status(429).json({
        error: "Limite de requisições excedido temporariamente (Erro 429). Por favor, aguarde alguns instantes e tente novamente.",
      });
    } else {
      res.status(500).json({
        error: `Falha na análise: ${error.message || error}`,
      });
    }
  } finally {
    isAnalyzing = false;
    // Clean up temporary local files
    if (tempFilePath) {
      if (fs.existsSync(tempFilePath)) {
        try {
          fs.unlinkSync(tempFilePath);
          console.log(`[Server] Temporary local file cleaned up: ${tempFilePath}`);
        } catch (err) {
          console.error(`[Server] Error deleting temporary file:`, err);
        }
      }
      if (fs.existsSync(tempFilePath + ".txt")) {
        try {
          fs.unlinkSync(tempFilePath + ".txt");
          console.log(`[Server] Converted temporary text file cleaned up: ${tempFilePath}.txt`);
        } catch (err) {
          console.error(`[Server] Error deleting converted temporary text file:`, err);
        }
      }
    }
    if (tempFilePathPrev) {
      if (fs.existsSync(tempFilePathPrev)) {
        try {
          fs.unlinkSync(tempFilePathPrev);
          console.log(`[Server] Temporary previous local file cleaned up: ${tempFilePathPrev}`);
        } catch (err) {
          console.error(`[Server] Error deleting temporary previous file:`, err);
        }
      }
      if (fs.existsSync(tempFilePathPrev + ".txt")) {
        try {
          fs.unlinkSync(tempFilePathPrev + ".txt");
          console.log(`[Server] Converted temporary previous text file cleaned up: ${tempFilePathPrev}.txt`);
        } catch (err) {
          console.error(`[Server] Error deleting converted temporary previous text file:`, err);
        }
      }
    }
    // Clean up files from Gemini cloud server to prevent storage build up
    if (uploadedFileRef) {
      try {
        console.log(`[Server] Cleaning up uploaded file on Gemini server: ${uploadedFileRef.name}...`);
        await ai.files.delete({ name: uploadedFileRef.name });
        console.log(`[Server] Gemini server file deleted.`);
      } catch (err) {
        console.error(`[Server] Error deleting file on Gemini:`, err);
      }
    }
    if (uploadedFileRefPrev) {
      try {
        console.log(`[Server] Cleaning up uploaded previous file on Gemini server: ${uploadedFileRefPrev.name}...`);
        await ai.files.delete({ name: uploadedFileRefPrev.name });
        console.log(`[Server] Gemini server previous file deleted.`);
      } catch (err) {
        console.error(`[Server] Error deleting previous file on Gemini:`, err);
      }
    }
  }
});

// Serve Frontend using Vite in development, or compiled static files in production
async function setupServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Server] Analista Financeiro running at http://localhost:${PORT}`);
  });
}

setupServer();
