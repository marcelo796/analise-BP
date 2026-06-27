import React, { useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import {
  Upload,
  FileText,
  Building,
  Calendar,
  Printer,
  CheckCircle,
  AlertTriangle,
  Sparkles,
  Percent,
  TrendingUp,
  Activity,
  DollarSign,
  ShieldAlert,
  Info,
  RefreshCw,
  TrendingDown,
  Lock,
  ChevronRight,
  BookOpen
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  ReferenceLine
} from "recharts";

// Interfaces from API
interface ExtractedData {
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

interface CalculatedIndicators {
  LiquidezCorrente: number | null;
  LiquidezSeca: number | null;
  LiquidezImediata: number | null;
  CapitalDeGiro: number;
  Endividamento: number | null;
  CapitalDeTerceiros: number | null;
  ImobilizacaoPL: number | null;
  MargemBruta: number | null;
  MargemOperacional: number | null;
  MargemLiquida: number | null;
  ROA: number | null;
  ROE: number | null;
  AtivoTotal: number;
  PassivoTotal: number;
  PassivoTotalEPais: number;
  DiferencaBalanco: number;
  BalancoConsistente: boolean;
}

interface AnalysisResult {
  success: boolean;
  companyName: string;
  period: string;
  extractedData: ExtractedData;
  indicators: CalculatedIndicators;
  reportMarkdown: string;
  isMillions?: boolean;
  hasPrevious?: boolean;
  periodPrev?: string;
  extractedDataPrev?: ExtractedData;
  indicatorsPrev?: CalculatedIndicators;
}

export default function App() {
  // Input states
  const [companyName, setCompanyName] = useState("");
  const [period, setPeriod] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileBase64, setFileBase64] = useState<string | null>(null);

  // Previous Period Comparative States
  const [hasPreviousPeriod, setHasPreviousPeriod] = useState<boolean | null>(null);
  const [periodPrev, setPeriodPrev] = useState("");
  const [fileNamePrev, setFileNamePrev] = useState("");
  const [fileBase64Prev, setFileBase64Prev] = useState<string | null>(null);
  
  // UX states
  const [isDragOver, setIsDragOver] = useState(false);
  const [isDragOverPrev, setIsDragOverPrev] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  
  // Dashboard navigation tab
  const [activeTab, setActiveTab] = useState<"resumo" | "indicadores" | "graficos" | "riscos" | "memorando">("resumo");

  // Read file as Base64 with multi-format support (PDF, Excel, TXT)
  const processFile = (file: File, isPrev: boolean = false) => {
    const ext = file.name.substring(file.name.lastIndexOf(".")).toLowerCase();
    const allowedExts = [".pdf", ".xlsx", ".xls", ".txt"];
    if (!allowedExts.includes(ext)) {
      setError("Por favor, envie um arquivo nos formatos suportados: PDF, Excel (XLSX/XLS) ou TXT.");
      return;
    }
    setError(null);
    if (isPrev) {
      setFileNamePrev(file.name);
    } else {
      setFileName(file.name);
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const base64 = e.target?.result as string;
      const cleanBase64 = base64.split(",")[1];
      if (isPrev) {
        setFileBase64Prev(cleanBase64);
      } else {
        setFileBase64(cleanBase64);
      }
    };
    reader.onerror = () => {
      setError("Erro ao ler o arquivo contábil.");
    };
    reader.readAsDataURL(file);
  };

  // Drag and drop handlers for main file
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFile(e.dataTransfer.files[0], false);
    }
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFile(e.target.files[0], false);
    }
  };

  // Drag and drop handlers for previous file
  const handleDragOverPrev = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOverPrev(true);
  }, []);

  const handleDragLeavePrev = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOverPrev(false);
  }, []);

  const handleDropPrev = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOverPrev(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFile(e.dataTransfer.files[0], true);
    }
  }, []);

  const handleFileChangePrev = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFile(e.target.files[0], true);
    }
  };

  // Submit trigger
  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fileBase64) {
      setError("Por favor, selecione ou arraste um arquivo de balancete.");
      return;
    }

    if (hasPreviousPeriod === null) {
      setError("Por favor, responda se possui o balancete do período anterior.");
      return;
    }

    if (hasPreviousPeriod === true && (!fileBase64Prev || !periodPrev.trim())) {
      setError("Por favor, informe o nome do período anterior e envie o balancete correspondente.");
      return;
    }

    setLoading(true);
    setError(null);
    
    // Staged reassuring steps
    const steps = [
      "Carregando os arquivos contábeis...",
      "Enviando dados para a Files API do Gemini...",
      "Processando estrutura contábil atual...",
      ...(hasPreviousPeriod ? ["Processando estrutura contábil anterior...", "Realizando comparações horizontais..."] : []),
      "Extraindo saldos e contas em JSON estruturado...",
      "Calculando indicadores econômico-financeiros...",
      "Redigindo memorando executivo especializado...",
    ];

    let currentStepIndex = 0;
    setLoadingStep(steps[currentStepIndex]);

    const stepInterval = setInterval(() => {
      if (currentStepIndex < steps.length - 1) {
        currentStepIndex++;
        setLoadingStep(steps[currentStepIndex]);
      }
    }, 4000);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          companyName: companyName.trim() || "Empresa não especificada",
          period: period.trim() || "Período não especificado",
          fileBase64,
          fileName,
          fileBase64Prev: hasPreviousPeriod ? fileBase64Prev : undefined,
          fileNamePrev: hasPreviousPeriod ? fileNamePrev : undefined,
          periodPrev: hasPreviousPeriod ? periodPrev.trim() : undefined,
        }),
      });

      clearInterval(stepInterval);

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Ocorreu um erro desconhecido no servidor.");
      }

      const data: AnalysisResult = await response.json();
      setResult(data);
      setActiveTab("resumo"); // Reset to main tab
    } catch (err: any) {
      clearInterval(stepInterval);
      setError(err.message || "Erro de conexão com o servidor.");
    } finally {
      setLoading(false);
    }
  };

  // Clear current result and reset fields
  const handleReset = () => {
    setResult(null);
    setFileName("");
    setFileBase64(null);
    setCompanyName("");
    setPeriod("");
    setHasPreviousPeriod(null);
    setPeriodPrev("");
    setFileNamePrev("");
    setFileBase64Prev(null);
  };


  // Helper formatting values to BRL currency
  const formatBRL = (val: number) => {
    const isMillionsMode = result?.isMillions;
    if (isMillionsMode) {
      // Milllion figures represented in Thousands (Reais Mil) without decimal parts or currency prefix
      return "R$ " + val.toLocaleString("pt-BR", {
        maximumFractionDigits: 0,
      });
    }
    return val.toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });
  };

  // Helper row renderer for comparative horizontal accounting lines
  const renderAccountRow = (
    label: string,
    currentVal: number,
    prevVal?: number,
    plClass: string = ""
  ) => {
    const hasPrev = prevVal !== undefined && prevVal !== null;
    const variation = hasPrev ? ((currentVal - prevVal) / (prevVal || 1)) * 100 : 0;
    const isZero = prevVal === 0 && currentVal === 0;

    return (
      <div className={`flex justify-between items-center text-[11px] font-mono border-b border-slate-800 pb-1.5 pt-1 uppercase ${plClass}`}>
        <span className="text-slate-500 truncate mr-2">{label}</span>
        <div className="flex items-center space-x-4 shrink-0">
          {hasPrev && (
            <span className="text-slate-400 font-medium w-28 text-right" title={`Período Anterior (${result?.periodPrev})`}>
              {formatBRL(prevVal)}
            </span>
          )}
          <span className={`font-bold text-white text-right ${hasPrev ? "w-28" : ""}`} title={`Período Atual (${result?.period})`}>
            {formatBRL(currentVal)}
          </span>
          {hasPrev && (
            <div className="w-16 flex justify-end">
              {!isZero ? (
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded leading-none ${
                  variation >= 0 ? "text-emerald-400 bg-emerald-500/10" : "text-rose-400 bg-rose-500/10"
                }`}>
                  {variation >= 0 ? "+" : ""}{variation.toFixed(1)}%
                </span>
              ) : (
                <span className="text-slate-600 font-bold">-</span>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  // Helper row renderer for total horizontal accounting sums
  const renderTotalRow = (
    label: string,
    currentVal: number,
    prevVal?: number,
    isPositiveColor: boolean = false
  ) => {
    const hasPrev = prevVal !== undefined && prevVal !== null;
    const variation = hasPrev ? ((currentVal - prevVal) / (prevVal || 1)) * 100 : 0;
    const isZero = prevVal === 0 && currentVal === 0;

    return (
      <div className="flex justify-between items-center text-[11px] font-mono bg-slate-850 p-2.5 rounded mt-2 uppercase border border-slate-800">
        <span className="font-bold text-indigo-300 truncate mr-2">{label}</span>
        <div className="flex items-center space-x-4 shrink-0">
          {hasPrev && (
            <span className="text-slate-400 font-bold w-28 text-right" title={`Período Anterior (${result?.periodPrev})`}>
              {formatBRL(prevVal)}
            </span>
          )}
          <span className={`font-black text-right ${hasPrev ? "w-28" : ""} ${isPositiveColor ? "text-emerald-400 underline decoration-double" : "text-white"}`} title={`Período Atual (${result?.period})`}>
            {formatBRL(currentVal)}
          </span>
          {hasPrev && (
            <div className="w-16 flex justify-end">
              {!isZero ? (
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded leading-none ${
                  variation >= 0 ? "text-emerald-400 bg-emerald-500/10" : "text-rose-400 bg-rose-500/10"
                }`}>
                  {variation >= 0 ? "+" : ""}{variation.toFixed(1)}%
                </span>
              ) : (
                <span className="text-slate-600 font-bold">-</span>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  // Evaluate risk colors and thresholds
  const getLiquidezRating = (val: number | null) => {
    if (val === null) return { text: "Sem dados", bg: "bg-gray-100", textCol: "text-gray-800", rating: "Neutro" };
    if (val >= 2.0) return { text: "Excelente (>= 2.0)", bg: "bg-emerald-100 text-emerald-800", rating: "Excelente" };
    if (val >= 1.5) return { text: "Bom (>= 1.5)", bg: "bg-green-100 text-green-800", rating: "Bom" };
    if (val >= 1.0) return { text: "Aceitável (>= 1.0)", bg: "bg-yellow-100 text-yellow-800", rating: "Alerta" };
    return { text: "Crítico (< 1.0)", bg: "bg-red-100 text-red-800", rating: "Perigoso" };
  };

  const getLiquidezSecaRating = (val: number | null) => {
    if (val === null) return { text: "Sem dados", bg: "bg-gray-100", textCol: "text-gray-800", rating: "Neutro" };
    if (val >= 1.5) return { text: "Excelente (>= 1.5)", bg: "bg-emerald-100 text-emerald-800", rating: "Excelente" };
    if (val >= 1.0) return { text: "Bom (>= 1.0)", bg: "bg-green-100 text-green-800", rating: "Bom" };
    if (val >= 0.8) return { text: "Aceitável (>= 0.8)", bg: "bg-yellow-100 text-yellow-800", rating: "Alerta" };
    return { text: "Crítico (< 0.8)", bg: "bg-red-100 text-red-800", rating: "Perigoso" };
  };

  const getLiquidezImediataRating = (val: number | null) => {
    if (val === null) return { text: "Sem dados", bg: "bg-gray-100", textCol: "text-gray-800", rating: "Neutro" };
    if (val >= 0.5) return { text: "Excelente (>= 0.5)", bg: "bg-emerald-100 text-emerald-800", rating: "Excelente" };
    if (val >= 0.2) return { text: "Bom (>= 0.2)", bg: "bg-green-100 text-green-800", rating: "Bom" };
    if (val >= 0.05) return { text: "Aceitável (>= 0.05)", bg: "bg-yellow-100 text-yellow-800", rating: "Alerta" };
    return { text: "Crítico (< 0.05)", bg: "bg-red-100 text-red-800", rating: "Perigoso" };
  };

  const getEndividamentoRating = (val: number | null) => {
    if (val === null) return { text: "Sem dados", bg: "bg-gray-100", textCol: "text-gray-800", rating: "Neutro" };
    if (val <= 0.4) return { text: "Excelente (<= 40%)", bg: "bg-emerald-100 text-emerald-800", rating: "Excelente" };
    if (val <= 0.6) return { text: "Bom (<= 60%)", bg: "bg-green-100 text-green-800", rating: "Saudável" };
    if (val <= 0.75) return { text: "Alerta (60% - 75%)", bg: "bg-yellow-100 text-yellow-800", rating: "Alerta" };
    return { text: "Crítico (> 75%)", bg: "bg-red-100 text-red-800", rating: "Crítico" };
  };

  const getTerceirosRating = (val: number | null) => {
    if (val === null) return { text: "Sem dados", bg: "bg-gray-100", textCol: "text-gray-800", rating: "Neutro" };
    if (val <= 0.5) return { text: "Excelente (<= 50%)", bg: "bg-emerald-100 text-emerald-800", rating: "Excelente" };
    if (val <= 1.0) return { text: "Equilibrado (<= 100%)", bg: "bg-green-100 text-green-800", rating: "Bom" };
    if (val <= 2.0) return { text: "Moderado (100% - 200%)", bg: "bg-yellow-100 text-yellow-800", rating: "Alerta" };
    return { text: "Crítico (> 200%)", bg: "bg-red-100 text-red-800", rating: "Crítico" };
  };

  const getImobilizacaoRating = (val: number | null) => {
    if (val === null) return { text: "Sem dados", bg: "bg-gray-100", textCol: "text-gray-800", rating: "Neutro" };
    if (val <= 0.5) return { text: "Excelente (<= 50%)", bg: "bg-emerald-100 text-emerald-800", rating: "Excelente" };
    if (val <= 0.8) return { text: "Saudável (<= 80%)", bg: "bg-green-100 text-green-800", rating: "Saudável" };
    if (val <= 1.0) return { text: "No Limite (80% - 100%)", bg: "bg-yellow-100 text-yellow-800", rating: "Alerta" };
    return { text: "Sobreimobilizado (> 100%)", bg: "bg-red-100 text-red-800", rating: "Crítico" };
  };

  const getMargemRating = (val: number | null) => {
    if (val === null) return { text: "Sem dados", bg: "bg-gray-100", textCol: "text-gray-800", rating: "Neutro" };
    if (val >= 0.2) return { text: "Excelente (>= 20%)", bg: "bg-emerald-100 text-emerald-800", rating: "Excelente" };
    if (val >= 0.1) return { text: "Boa (>= 10%)", bg: "bg-green-100 text-green-800", rating: "Boa" };
    if (val >= 0.03) return { text: "Apertada (3% - 10%)", bg: "bg-yellow-100 text-yellow-800", rating: "Alerta" };
    return { text: "Crítica / Negativa (< 3%)", bg: "bg-red-100 text-red-800", rating: "Alerta Vermelho" };
  };

  const handleExportPrintableHTML = () => {
    if (!result) return;

    const isMillionsMode = result.isMillions;
    const formatBRLHtml = (val: number) => {
      if (isMillionsMode) {
        return "R$ " + val.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
      }
      return val.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    };

    const hasPrev = result.periodPrev !== undefined && result.periodPrev !== null;

    const balancoRows = [
      { label: "Ativo Circulante (AC)", current: result.extractedData.AtivoCirculante, prev: result.extractedDataPrev?.AtivoCirculante, indent: false },
      { label: "• Estoques", current: result.extractedData.Estoques, prev: result.extractedDataPrev?.Estoques, indent: true },
      { label: "• Disponível (Caixa e Bancos)", current: result.extractedData.Disponivel, prev: result.extractedDataPrev?.Disponivel, indent: true },
      { label: "Ativo Não Circulante (ANC)", current: result.extractedData.AtivoNaoCirculante, prev: result.extractedDataPrev?.AtivoNaoCirculante, indent: false },
      { label: "• Imobilizado", current: result.extractedData.Imobilizado, prev: result.extractedDataPrev?.Imobilizado, indent: true },
    ];
    const assetTotalCurrent = result.indicators.AtivoTotal;
    const assetTotalPrev = result.indicatorsPrev?.AtivoTotal;

    const passivoRows = [
      { label: "Passivo Circulante (PC)", current: result.extractedData.PassivoCirculante, prev: result.extractedDataPrev?.PassivoCirculante, indent: false },
      { label: "Passivo Não Circulante (PNC)", current: result.extractedData.PassivoNaoCirculante, prev: result.extractedDataPrev?.PassivoNaoCirculante, indent: false },
      { label: "Patrimônio Líquido (PL)", current: result.extractedData.PatrimonioLiquido, prev: result.extractedDataPrev?.PatrimonioLiquido, indent: false },
    ];
    const passivoTotalCurrent = result.indicators.PassivoTotalEPais;
    const passivoTotalPrev = result.indicatorsPrev?.PassivoTotalEPais;

    const dreRows = [
      { label: "Receita Bruta", current: result.extractedData.ReceitaBruta, prev: result.extractedDataPrev?.ReceitaBruta, highlight: false },
      { label: "Deduções de Impostos/Vendas", current: result.extractedData.Deducoes, prev: result.extractedDataPrev?.Deducoes, highlight: false },
      { label: "Receita Líquida", current: result.extractedData.ReceitaLiquida, prev: result.extractedDataPrev?.ReceitaLiquida, highlight: true },
      { label: "Custos das Mercadorias/Produtos", current: result.extractedData.Custos, prev: result.extractedDataPrev?.Custos, highlight: false },
      { label: "Resultado Bruto", current: result.extractedData.ResultadoBruto, prev: result.extractedDataPrev?.ResultadoBruto, highlight: true },
      { label: "Despesas Operacionais", current: result.extractedData.DespesasOperacionais, prev: result.extractedDataPrev?.DespesasOperacionais, highlight: false },
      { label: "Resultado Operacional (EBIT)", current: result.extractedData.ResultadoOperacional, prev: result.extractedDataPrev?.ResultadoOperacional, highlight: true },
      { label: "RESULTADO LÍQUIDO (LUCRO)", current: result.extractedData.ResultadoLiquido, prev: result.extractedDataPrev?.ResultadoLiquido, highlight: true, isTotal: true },
    ];

    const generateRowsHtml = (rows: any[]) => {
      return rows.map(r => {
        const valDiff = (r.prev !== undefined && r.prev !== null) ? r.current - r.prev : 0;
        const variation = r.prev ? (valDiff / (r.prev || 1)) * 100 : 0;
        const isZero = r.prev === 0 && r.current === 0;

        return `
          <tr class="${r.highlight ? 'bg-slate-50 font-bold' : ''} ${r.isTotal ? 'border-t-2 border-slate-900 font-extrabold text-indigo-950' : 'border-b border-slate-200'}">
            <td class="py-2.5 px-3 text-xs text-slate-800 ${r.indent ? 'pl-6 text-slate-500' : ''}">${r.label}</td>
            ${hasPrev ? `
              <td class="py-2.5 px-3 text-xs text-right font-mono text-slate-500">${r.prev !== undefined && r.prev !== null ? formatBRLHtml(r.prev) : '-'}</td>
            ` : ''}
            <td class="py-2.5 px-3 text-xs text-right font-mono font-bold text-slate-900">${formatBRLHtml(r.current)}</td>
            ${hasPrev ? `
              <td class="py-2.5 px-3 text-xs text-right font-mono font-bold ${variation >= 0 ? 'text-emerald-600' : 'text-rose-600'}">
                ${isZero ? '-' : `${variation >= 0 ? '+' : ''}${variation.toFixed(1)}%`}
              </td>
            ` : ''}
          </tr>
        `;
      }).join('');
    };

    const getIndicatorHtml = (title: string, formula: string, sub: string, value: number | null, rating: string, bgClass: string, desc: string) => {
      return `
        <div class="border border-slate-200 rounded-xl p-4 bg-white shadow-sm flex flex-col justify-between break-inside-avoid">
          <div class="space-y-2">
            <div class="flex justify-between items-start mb-2">
              <h4 class="text-xs font-bold text-slate-500 uppercase">${title}</h4>
              <span class="text-[10px] font-bold px-2.5 py-1 rounded-full ${bgClass}">${rating}</span>
            </div>
            <div class="text-2xl font-black text-indigo-600 font-mono">
              ${value !== null ? value.toFixed(2) : 'N/A'}
            </div>
            <div class="bg-slate-50 p-2.5 rounded text-[10px] text-slate-600 font-mono space-y-0.5 border border-slate-200">
              <div><strong>Fórmula:</strong> ${formula}</div>
              <div><strong>Valores:</strong> ${sub}</div>
            </div>
          </div>
          <p class="text-[11px] text-slate-500 leading-normal mt-3 font-medium">${desc}</p>
        </div>
      `;
    };

    const companyNameClean = companyName.trim() || result.companyName || "Empresa sob Análise";
    const periodClean = result.period;
    const periodPrevClean = result.periodPrev;

    const htmlContent = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Relatório Financeiro Executivo - ${companyNameClean}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Space+Grotesk:wght@500;700&display=swap" rel="stylesheet">
  <style>
    body {
      font-family: 'Inter', sans-serif;
      background-color: #f8fafc;
    }
    .font-display {
      font-family: 'Space Grotesk', sans-serif;
    }
    @media print {
      body {
        background-color: white;
      }
      .no-print {
        display: none !important;
      }
      .break-inside-avoid {
        break-inside: avoid;
      }
      .print-break {
        page-break-before: always;
      }
    }
  </style>
</head>
<body class="p-4 sm:p-8 text-slate-900 max-w-5xl mx-auto">
  <!-- Bar de ações flutuante (Oculta na impressão) -->
  <div class="no-print mb-6 bg-slate-900 text-white rounded-xl p-4 shadow-md flex justify-between items-center">
    <div>
      <h2 class="text-sm font-bold font-display uppercase tracking-wider">Visualização Otimizada para PDF</h2>
      <p class="text-xs text-slate-300">Este arquivo foi baixado para contornar restrições de iFrame do navegador. Você pode salvar como PDF ou imprimir abaixo.</p>
    </div>
    <div class="flex space-x-3 shrink-0">
      <button onclick="window.print()" class="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded text-xs font-bold uppercase transition-colors shadow">
        Imprimir / Salvar como PDF
      </button>
    </div>
  </div>

  <!-- Cabeçalho Principal do Relatório -->
  <header class="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-sm mb-8">
    <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
      <div>
        <span class="bg-indigo-100 text-indigo-800 text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-widest font-mono">
          Relatório de Diagnóstico Econômico-Financeiro IA
        </span>
        <h1 class="text-2xl sm:text-3xl font-black font-display text-slate-900 mt-2 uppercase tracking-tight">${companyNameClean}</h1>
        <p class="text-xs text-slate-500 font-mono uppercase mt-1 tracking-wider">
          Período Principal: <strong>${periodClean}</strong> ${periodPrevClean ? `| Período Comparativo: <strong>${periodPrevClean}</strong>` : ''}
        </p>
      </div>
      <div class="text-left md:text-right font-mono text-[11px] text-slate-400">
        <p>DATA DE EMISSÃO: ${new Date().toLocaleDateString("pt-BR")}</p>
        <p>SISTEMA: ANALISTA DE BALANCETES IA</p>
        <p class="text-indigo-600 font-bold mt-1">${isMillionsMode ? 'VALORES EM REAIS MIL (R$ MIL)' : 'VALORES EM REAIS (R$)'}</p>
      </div>
    </div>
  </header>

  <!-- 1. GRANDES GRUPOS CONTÁBEIS (Balanço e DRE) -->
  <section class="mb-8 break-inside-avoid">
    <div class="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
      <h2 class="text-sm font-black font-display text-slate-800 uppercase tracking-wider border-b border-slate-200 pb-3 mb-6">
        1. Estrutura de Balancete e Demonstrações Financeiras
      </h2>
      
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <!-- Balanço Patrimonial -->
        <div>
          <h3 class="text-xs font-bold text-indigo-600 uppercase tracking-widest mb-3 border-l-2 border-indigo-600 pl-2">Balanço Patrimonial</h3>
          <table class="w-full">
            <thead>
              <tr class="border-b-2 border-slate-300">
                <th class="text-left py-2.5 px-3 text-[10px] font-bold text-slate-400 uppercase">Grupo Patrimonial</th>
                ${hasPrev ? `<th class="text-right py-2.5 px-3 text-[10px] font-bold text-slate-400 uppercase">ANO: ${periodPrevClean}</th>` : ''}
                <th class="text-right py-2.5 px-3 text-[10px] font-bold text-slate-400 uppercase">ANO: ${periodClean}</th>
                ${hasPrev ? `<th class="text-right py-2.5 px-3 text-[10px] font-bold text-slate-400 uppercase">Var.%</th>` : ''}
              </tr>
            </thead>
            <tbody>
              ${generateRowsHtml(balancoRows)}
              <!-- Soma Ativo -->
              <tr class="bg-indigo-50 font-extrabold text-indigo-950">
                <td class="py-2.5 px-3 text-xs">SOMA DO ATIVO TOTAL</td>
                ${hasPrev ? `<td class="py-2.5 px-3 text-xs text-right font-mono">${formatBRLHtml(assetTotalPrev || 0)}</td>` : ''}
                <td class="py-2.5 px-3 text-xs text-right font-mono">${formatBRLHtml(assetTotalCurrent)}</td>
                ${hasPrev ? `
                  <td class="py-2.5 px-3 text-xs text-right font-mono ${((assetTotalCurrent - (assetTotalPrev || 0)) / (assetTotalPrev || 1)) >= 0 ? 'text-emerald-700' : 'text-rose-700'}">
                    ${((assetTotalCurrent - (assetTotalPrev || 0)) / (assetTotalPrev || 1) * 100).toFixed(1)}%
                  </td>
                ` : ''}
              </tr>
              <!-- Espaço -->
              <tr><td colspan="${hasPrev ? 4 : 2}" class="py-2"></td></tr>
              ${generateRowsHtml(passivoRows)}
              <!-- Soma Passivo -->
              <tr class="bg-indigo-50 font-extrabold text-indigo-950">
                <td class="py-2.5 px-3 text-xs">SOMA DO PASSIVO + PL</td>
                ${hasPrev ? `<td class="py-2.5 px-3 text-xs text-right font-mono">${formatBRLHtml(passivoTotalPrev || 0)}</td>` : ''}
                <td class="py-2.5 px-3 text-xs text-right font-mono">${formatBRLHtml(passivoTotalCurrent)}</td>
                ${hasPrev ? `
                  <td class="py-2.5 px-3 text-xs text-right font-mono ${((passivoTotalCurrent - (passivoTotalPrev || 0)) / (passivoTotalPrev || 1)) >= 0 ? 'text-emerald-700' : 'text-rose-700'}">
                    ${((passivoTotalCurrent - (passivoTotalPrev || 0)) / (passivoTotalPrev || 1) * 100).toFixed(1)}%
                  </td>
                ` : ''}
              </tr>
            </tbody>
          </table>
          
          <div class="mt-4 p-3 rounded-lg border text-xs leading-relaxed ${result.indicators.BalancoConsistente ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'}">
            <strong>Equilíbrio Patrimonial:</strong> ${result.indicators.BalancoConsistente 
              ? 'Consistência Validada! O balanço está em perfeito equilíbrio (Ativo = Passivo + PL).' 
              : `Divergência detectada de ${formatBRLHtml(result.indicators.DiferencaBalanco)}.`}
          </div>
        </div>

        <!-- DRE -->
        <div>
          <h3 class="text-xs font-bold text-indigo-600 uppercase tracking-widest mb-3 border-l-2 border-indigo-600 pl-2">Demonstração do Resultado (DRE)</h3>
          <table class="w-full">
            <thead>
              <tr class="border-b-2 border-slate-300">
                <th class="text-left py-2.5 px-3 text-[10px] font-bold text-slate-400 uppercase">Grupo de Resultados</th>
                ${hasPrev ? `<th class="text-right py-2.5 px-3 text-[10px] font-bold text-slate-400 uppercase">ANO: ${periodPrevClean}</th>` : ''}
                <th class="text-right py-2.5 px-3 text-[10px] font-bold text-slate-400 uppercase">ANO: ${periodClean}</th>
                ${hasPrev ? `<th class="text-right py-2.5 px-3 text-[10px] font-bold text-slate-400 uppercase">Var.%</th>` : ''}
              </tr>
            </thead>
            <tbody>
              ${generateRowsHtml(dreRows)}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </section>

  <!-- 2. INDICADORES FINANCEIROS -->
  <section class="mb-8 break-inside-avoid">
    <div class="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
      <h2 class="text-sm font-black font-display text-slate-800 uppercase tracking-wider border-b border-slate-200 pb-3 mb-6">
        2. Indicadores de Desempenho e Solvência
      </h2>
      
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <!-- Liquidez Corrente -->
        ${getIndicatorHtml(
          "Liquidez Corrente",
          "Ativo Circulante / Passivo Circulante",
          `${formatBRLHtml(result.extractedData.AtivoCirculante)} / ${formatBRLHtml(result.extractedData.PassivoCirculante)}`,
          result.indicators.LiquidezCorrente,
          getLiquidezRating(result.indicators.LiquidezCorrente).rating,
          getLiquidezRating(result.indicators.LiquidezCorrente).bg,
          "Indica a capacidade financeira de curto prazo da empresa para pagar seus compromissos imediatos."
        )}

        <!-- Liquidez Seca -->
        ${getIndicatorHtml(
          "Liquidez Seca",
          "(Ativo Circulante - Estoques) / Passivo Circulante",
          `(${formatBRLHtml(result.extractedData.AtivoCirculante)} - ${formatBRLHtml(result.extractedData.Estoques)}) / ${formatBRLHtml(result.extractedData.PassivoCirculante)}`,
          result.indicators.LiquidezSeca,
          getLiquidezSecaRating(result.indicators.LiquidezSeca).rating,
          getLiquidezSecaRating(result.indicators.LiquidezSeca).bg,
          "Mede a solvência eliminando a dependência dos estoques, que representam ativos menos líquidos."
        )}

        <!-- Endividamento Geral -->
        ${getIndicatorHtml(
          "Endividamento Geral",
          "(Passivo Circulante + Passivo Não Circulante) / Ativo Total",
          `(${formatBRLHtml(result.extractedData.PassivoCirculante)} + ${formatBRLHtml(result.extractedData.PassivoNaoCirculante)}) / ${formatBRLHtml(result.indicators.AtivoTotal)}`,
          result.indicators.Endividamento,
          result.indicators.Endividamento && result.indicators.Endividamento > 0.7 ? "CRÍTICO" : result.indicators.Endividamento && result.indicators.Endividamento > 0.5 ? "MODERADO" : "BAIXO",
          result.indicators.Endividamento && result.indicators.Endividamento > 0.7 ? "bg-red-100 text-red-800" : result.indicators.Endividamento && result.indicators.Endividamento > 0.5 ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800",
          "Revela o grau de dependência que a empresa possui de capitais de terceiros para financiar suas atividades."
        )}

        <!-- Margem Líquida -->
        ${getIndicatorHtml(
          "Margem Líquida",
          "Resultado Líquido / Receita Líquida",
          `${formatBRLHtml(result.extractedData.ResultadoLiquido)} / ${formatBRLHtml(result.extractedData.ReceitaLiquida)}`,
          result.indicators.MargemLiquida,
          result.indicators.MargemLiquida && result.indicators.MargemLiquida < 0.03 ? "CRÍTICO" : result.indicators.MargemLiquida && result.indicators.MargemLiquida < 0.10 ? "MODERADO" : "EXCELENTE",
          result.indicators.MargemLiquida && result.indicators.MargemLiquida < 0.03 ? "bg-red-100 text-red-800" : result.indicators.MargemLiquida && result.indicators.MargemLiquida < 0.10 ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800",
          "Indica a porcentagem de cada real faturado que restou sob a forma de lucro após todas as despesas e deduções."
        )}
      </div>
    </div>
  </section>

  <!-- 3. MEMORANDO DE ANÁLISE (IMPRESSÃO CONTINUA) -->
  <section class="print-break mb-8">
    <div class="bg-white border border-slate-200 rounded-2xl p-6 sm:p-10 shadow-sm">
      <div class="border-b-2 border-indigo-600 pb-4 mb-6 flex justify-between items-center">
        <div>
          <h2 class="text-lg font-black font-display text-slate-950 uppercase tracking-wider">
            Memorando de Análise Financeira Executiva
          </h2>
          <p class="text-[9px] text-slate-400 font-mono tracking-widest mt-1">CONFIDENCIAL • DOCUMENTO INTERNO</p>
        </div>
        <div class="text-right font-mono text-[10px] text-slate-400">
          <p>DATA: ${new Date().toLocaleDateString("pt-BR")}</p>
        </div>
      </div>
      
      <!-- Onde o Markdown será renderizado -->
      <div id="rendered-memo" class="prose prose-slate max-w-none text-slate-800 text-justify leading-relaxed text-sm space-y-4">
        Carregando análise executiva...
      </div>
    </div>
  </section>

  <!-- Rodapé Corporativo -->
  <footer class="border-t border-slate-200 pt-6 text-center text-[10px] text-slate-400 font-mono uppercase tracking-widest mt-12">
    <p>GERADO EXCLUSIVAMENTE PELO ANALISTA FINANCEIRO DE BALANCETES INTELIGÊNCIA ARTIFICIAL</p>
  </footer>

  <div id="raw-markdown" style="display: none;">${encodeURIComponent(result.reportMarkdown)}</div>

  <script>
    window.onload = function() {
      const rawMd = decodeURIComponent(document.getElementById('raw-markdown').textContent);
      document.getElementById('rendered-memo').innerHTML = marked.parse(rawMd);
      
      setTimeout(function() {
        window.print();
      }, 600);
    }
  </script>
</body>
</html>`;

    const blob = new Blob([htmlContent], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Relatorio_Financeiro_${companyNameClean.replace(/\s+/g, "_")}_${periodClean.replace(/\s+/g, "_")}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handlePrint = () => {
    // Attempt standard window.print first
    try {
      window.print();
    } catch (e) {
      console.warn("window.print block detected in sandboxed environment, downloading printable HTML document instead.");
    }
    // Always trigger the robust auto-print HTML export as well to guarantee success for the user!
    handleExportPrintableHTML();
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans antialiased selection:bg-indigo-100">
      {/* Header (Hidden on Print) */}
      <header id="header-root" className="no-print bg-white border-b border-slate-200 sticky top-0 z-40 transition-shadow hover:shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="w-10 h-10 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-black text-xl shadow-sm shrink-0">
              AF
            </div>
            <div>
              <h1 className="text-lg font-bold leading-tight text-slate-900 font-display" id="app-title">
                Analista Financeiro de Balancetes
              </h1>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">
                Relatório Executivo Automático
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-6">
            {result && (
              <div className="text-right hidden sm:block">
                <p className="text-xs font-bold text-slate-700 italic">{result.companyName}</p>
                <p className="text-[10px] text-slate-400 font-mono">PERÍODO: {result.period}</p>
              </div>
            )}
            <div className="flex items-center">
              <span className="text-xs font-mono bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full flex items-center border border-slate-200">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 mr-1.5 animate-pulse"></span>
                Servidor Conectado
              </span>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Upload Form - Hidden on Print or when results are loaded */}
        {!result && (
          <div className="max-w-3xl mx-auto no-print">
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="p-6 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
                <div>
                  <h2 className="text-lg font-bold font-display flex items-center">
                    <Sparkles className="h-5 w-5 mr-2 text-indigo-400 animate-pulse" />
                    Nova Análise Contábil
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Envie o balancete em PDF, Excel ou TXT para iniciar a extração e diagnóstico financeiro.
                  </p>
                </div>
                <BookOpen className="h-6 w-6 text-slate-400" />
              </div>

              <form onSubmit={handleAnalyze} className="p-6 space-y-6">
                {/* Meta Inputs */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="company-name" className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                      Nome da Empresa <span className="text-slate-400 font-normal">(opcional)</span>
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                        <Building className="h-4 w-4" />
                      </div>
                      <input
                        type="text"
                        id="company-name"
                        value={companyName}
                        onChange={(e) => setCompanyName(e.target.value)}
                        placeholder="Ex: Alfa Industrial Ltda"
                        className="block w-full pl-10 pr-3 py-2.5 border border-slate-300 rounded-lg text-sm bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all font-medium text-slate-800"
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="period" className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                      Período de Análise
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                        <Calendar className="h-4 w-4" />
                      </div>
                      <input
                        type="text"
                        id="period"
                        value={period}
                        onChange={(e) => setPeriod(e.target.value)}
                        placeholder="Ex: Ano de 2025 ou 1º Semestre 2026"
                        required
                        className="block w-full pl-10 pr-3 py-2.5 border border-slate-300 rounded-lg text-sm bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all font-medium text-slate-800"
                      />
                    </div>
                  </div>
                </div>

                {/* File Upload Box */}
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                    Arquivo do Balancete (PDF, Excel ou TXT)
                  </label>
                  
                  <div
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
                      isDragOver
                        ? "border-indigo-500 bg-indigo-50/10"
                        : fileName
                        ? "border-emerald-400 bg-emerald-50/10 hover:bg-emerald-50/20"
                        : "border-slate-300 bg-slate-50/50 hover:bg-slate-50"
                    }`}
                    onClick={() => document.getElementById("file-input")?.click()}
                  >
                    <input
                      id="file-input"
                      type="file"
                      accept="application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/plain"
                      onChange={handleFileChange}
                      className="hidden"
                    />

                    {fileName ? (
                      <div className="space-y-2">
                        <div className="mx-auto h-12 w-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center shadow-sm">
                           <CheckCircle className="h-6 w-6" />
                        </div>
                        <div>
                          <p className="text-sm font-bold text-slate-800 max-w-md mx-auto truncate">
                            {fileName}
                          </p>
                          <p className="text-xs text-slate-500 mt-1">
                            Clique ou arraste outro arquivo para substituir.
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="mx-auto h-12 w-12 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center shadow-sm">
                          <Upload className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="text-sm font-bold text-slate-800">
                            Arraste o arquivo (PDF, Excel ou TXT) aqui
                          </p>
                          <p className="text-xs text-slate-500 mt-1">
                            Ou clique para navegar nos seus arquivos locais
                          </p>
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono mt-4">
                          Formatos aceitos: PDF, XLSX, XLS, TXT
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Previous Period Comparative Selector Questionnaire */}
                <div className="bg-indigo-50/30 rounded-xl p-5 border border-indigo-100 space-y-4">
                  <div className="flex items-center space-x-2">
                    <Sparkles className="h-5 w-5 text-indigo-600 animate-pulse" />
                    <h3 className="text-sm font-bold text-slate-800">
                      Possui o balancete de um período anterior para comparação?
                    </h3>
                  </div>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Ao fornecer dados de dois períodos consecutivos, geramos uma análise comparativa e horizontal extremamente rica, revelando tendências de crescimento, endividamento e evolução patrimonial. Se não possuir o período anterior, calcularemos apenas do período atual.
                  </p>

                  <div className="flex gap-4">
                    <button
                      type="button"
                      onClick={() => setHasPreviousPeriod(false)}
                      className={`flex-1 py-2.5 px-4 rounded-lg border text-xs font-bold transition-all flex items-center justify-center space-x-2 ${
                        hasPreviousPeriod === false
                          ? "bg-slate-800 text-white border-slate-800 shadow-sm"
                          : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      <span>Não tenho o período anterior (Análise Simples)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setHasPreviousPeriod(true)}
                      className={`flex-1 py-2.5 px-4 rounded-lg border text-xs font-bold transition-all flex items-center justify-center space-x-2 ${
                        hasPreviousPeriod === true
                          ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                          : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      <span>Sim, tenho o período anterior (Análise Comparativa)</span>
                    </button>
                  </div>

                  {hasPreviousPeriod === true && (
                    <div className="pt-4 space-y-4 border-t border-slate-200/60 animate-fade-in">
                      <div>
                        <label htmlFor="period-prev" className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                          Identificação do Período Anterior
                        </label>
                        <div className="relative">
                          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                            <Calendar className="h-4 w-4" />
                          </div>
                          <input
                            type="text"
                            id="period-prev"
                            value={periodPrev}
                            onChange={(e) => setPeriodPrev(e.target.value)}
                            placeholder="Ex: Ano de 2024 ou 2º Semestre de 2025"
                            required={hasPreviousPeriod === true}
                            className="block w-full pl-10 pr-3 py-2.5 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all font-medium text-slate-800"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                          Arquivo do Balancete Anterior (PDF, Excel ou TXT)
                        </label>
                        <div
                          onDragOver={handleDragOverPrev}
                          onDragLeave={handleDragLeavePrev}
                          onDrop={handleDropPrev}
                          className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
                            isDragOverPrev
                              ? "border-indigo-500 bg-indigo-50/10"
                              : fileNamePrev
                              ? "border-emerald-400 bg-emerald-50/10 hover:bg-emerald-50/20"
                              : "border-slate-300 bg-white hover:bg-slate-50"
                          }`}
                          onClick={() => document.getElementById("file-input-prev")?.click()}
                        >
                          <input
                            id="file-input-prev"
                            type="file"
                            accept="application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/plain"
                            onChange={handleFileChangePrev}
                            className="hidden"
                          />

                          {fileNamePrev ? (
                            <div className="space-y-2">
                              <div className="mx-auto h-10 w-10 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center shadow-sm">
                                <CheckCircle className="h-5 w-5" />
                              </div>
                              <div>
                                <p className="text-xs font-bold text-slate-800 max-w-md mx-auto truncate">
                                  {fileNamePrev}
                                </p>
                                <p className="text-[10px] text-slate-500 mt-1">
                                  Clique ou arraste outro arquivo para substituir.
                                </p>
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-2">
                              <div className="mx-auto h-10 w-10 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center shadow-sm">
                                <Upload className="h-4 w-4" />
                              </div>
                              <div>
                                <p className="text-xs font-bold text-slate-800">
                                  Arraste o balancete anterior aqui
                                </p>
                                <p className="text-[10px] text-slate-400 mt-1">
                                  Ou clique para navegar nos seus arquivos locais
                                </p>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Security and Free-Tier Info Badge */}
                <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 space-y-2">
                  <div className="flex items-start space-x-2">
                    <Lock className="h-4 w-4 text-slate-500 mt-0.5 shrink-0" />
                    <div>
                      <h4 className="text-xs font-bold text-slate-800">Processamento Seguro e Limites da API</h4>
                      <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                        Seu arquivo é transferido com segurança e analisado temporariamente no servidor pela Files API do Gemini. 
                        Após o processamento dos saldos contábeis e redação do memorando executivo, o arquivo é imediatamente e permanentemente excluído dos servidores da Gemini e do nosso cache local. 
                        As regras da API gratuita garantem análises sucessivas respeitando o tempo de carência entre as requisições.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Error Banner */}
                {error && (
                  <div className="p-4 bg-red-50 rounded-xl border border-red-200 flex items-start space-x-3">
                    <AlertTriangle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
                    <div className="text-xs text-red-800 leading-relaxed font-medium">
                      {error}
                    </div>
                  </div>
                )}

                {/* Loading state or Submit */}
                {loading ? (
                  <div className="space-y-4 py-4 text-center">
                    <div className="inline-flex items-center space-x-3 px-4 py-2 rounded-full bg-indigo-600 text-white text-xs font-bold animate-pulse shadow-sm">
                      <RefreshCw className="h-4 w-4 animate-spin text-indigo-200" />
                      <span>{loadingStep}</span>
                    </div>
                    <p className="text-xs text-slate-400 max-w-sm mx-auto font-medium">
                      Isso pode levar de 30 a 60 segundos. O Gemini está interpretando as tabelas contábeis e calculando os indicadores de risco.
                    </p>
                  </div>
                ) : (
                  <div className="pt-2">
                    <button
                      type="submit"
                      disabled={!fileBase64}
                      className={`w-full py-3.5 px-4 rounded-lg font-bold text-sm transition-all text-center flex items-center justify-center space-x-2 ${
                        fileBase64
                          ? "bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm hover:shadow-md active:scale-[0.99] cursor-pointer"
                          : "bg-slate-200 text-slate-400 cursor-not-allowed"
                      }`}
                    >
                      <span>Analisar Balancete com IA</span>
                      <Sparkles className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </form>
            </div>
          </div>
        )}

        {/* Analysis Results View */}
        {result && (
          <div className="space-y-8 print-container">
            {/* Header metadata (Visible on screen and beautifully styled on print) */}
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-6 print-card">
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <span className="text-[10px] bg-indigo-600 text-white px-2.5 py-1 rounded-full font-bold font-mono tracking-wider uppercase">
                    Relatório Financeiro
                  </span>
                  <span className="text-[10px] bg-emerald-100 text-emerald-800 px-2.5 py-1 rounded-full font-bold uppercase tracking-wider">
                    Análise Concluída
                  </span>
                </div>
                <h2 className="text-2xl font-bold font-display text-slate-900">
                  {result.companyName}
                </h2>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 font-semibold uppercase tracking-wider">
                  <span className="flex items-center">
                    <Calendar className="h-3.5 w-3.5 mr-1 text-slate-400" />
                    Período: <strong className="text-slate-700 ml-1">{result.period}</strong>
                  </span>
                  <span className="flex items-center">
                    <FileText className="h-3.5 w-3.5 mr-1 text-slate-400" />
                    Arquivo: <strong className="text-slate-700 ml-1">{fileName || "Anexo Contábil"}</strong>
                  </span>
                </div>
              </div>

              {/* Action Buttons (Hidden on Print) */}
              <div className="no-print flex items-center space-x-3 w-full md:w-auto">
                <button
                  onClick={handleReset}
                  className="flex-1 md:flex-initial py-2.5 px-4 rounded-md border border-slate-300 hover:bg-slate-100 text-slate-700 font-bold text-xs transition-colors flex items-center justify-center space-x-2 uppercase tracking-wider shadow-sm"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span>Nova Análise</span>
                </button>
                <button
                  onClick={handlePrint}
                  className="flex-1 md:flex-initial py-2.5 px-4 bg-indigo-600 text-white text-xs font-bold rounded-md shadow-sm hover:bg-indigo-700 transition-colors flex items-center justify-center space-x-2 uppercase tracking-wider"
                >
                  <Printer className="h-3.5 w-3.5" />
                  <span>IMPRIMIR PDF</span>
                </button>
              </div>
            </div>

            {/* Millions Warning Badge */}
            {result.isMillions && (
              <div className="bg-amber-50 border border-amber-200 text-amber-800 px-5 py-4 rounded-xl flex items-start gap-3 shadow-sm print:border-amber-400">
                <Info className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="text-xs font-medium space-y-1">
                  <p className="font-bold text-amber-900">Apresentação Simplificada em Reais Mil (R$ Mil)</p>
                  <p className="text-amber-800">
                    Como os saldos desta empresa são da casa dos milhões de reais, todos os dados contábeis, cálculos e representações numéricas foram convertidos e arredondados para **milhares de reais (Reais Mil) sem centavos/vírgula**, conforme solicitado.
                  </p>
                </div>
              </div>
            )}

            {/* Navigation Tabs (Hidden on Print) */}
            <div className="no-print border-b border-slate-200 overflow-x-auto whitespace-nowrap flex space-x-1 py-1">
              {[
                { id: "resumo", label: "Consistência & Dados", icon: CheckCircle },
                { id: "indicadores", label: "Indicadores Obrigatórios", icon: Percent },
                { id: "graficos", label: "Gráficos de Desempenho", icon: TrendingUp },
                { id: "riscos", label: "Mapa de Riscos", icon: ShieldAlert },
                { id: "memorando", label: "Memorando Executivo", icon: Sparkles }
              ].map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id as any)}
                    className={`py-2 px-4 text-xs font-bold rounded-lg flex items-center space-x-2 transition-all cursor-pointer ${
                      activeTab === tab.id
                        ? "bg-indigo-600 text-white shadow-sm"
                        : "text-slate-600 hover:text-slate-900 hover:bg-indigo-50/50"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Tab Contents */}
            
            {/* 1. VISÃO GERAL & CONSISTÊNCIA */}
            {(activeTab === "resumo" || window.matchMedia("print").matches) && (
              <div className="space-y-6 print-container">
                {/* Balance Sheet Consistency & Trust Score */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* Balance Sheet Check card */}
                  <div className={`md:col-span-2 p-6 rounded-2xl border-2 bg-white ${
                    result.indicators.BalancoConsistente 
                      ? "border-emerald-500 text-emerald-950" 
                      : "border-amber-500 text-amber-950"
                  } print-card shadow-sm`}>
                    <div className="flex items-start space-x-4">
                      {result.indicators.BalancoConsistente ? (
                        <div className="bg-emerald-100 text-emerald-600 p-2 rounded-full shrink-0 shadow-sm">
                          <CheckCircle className="h-6 w-6" />
                        </div>
                      ) : (
                        <div className="bg-amber-100 text-amber-600 p-2 rounded-full shrink-0 shadow-sm">
                          <AlertTriangle className="h-6 w-6" />
                        </div>
                      )}
                      <div className="space-y-1 w-full">
                        <p className={`text-[10px] font-black uppercase leading-none ${
                          result.indicators.BalancoConsistente ? "text-emerald-600" : "text-amber-600"
                        }`}>
                          {result.indicators.BalancoConsistente ? "Consistência Validada" : "Divergência Contábil"}
                        </p>
                        <h3 className="text-base font-bold text-slate-800">
                          Equilíbrio Patrimonial (Ativo = Passivo + PL)
                        </h3>
                        <p className="text-xs text-slate-500 leading-relaxed pt-1">
                          {result.indicators.BalancoConsistente 
                            ? "A validação matemática obrigatória foi bem-sucedida! O total de ativos equivale ao somatório dos passivos e patrimônio líquido, garantindo integridade contábil."
                            : "Alerta de divergência! O total de ativos possui diferença relevante em relação ao somatório de passivos e patrimônio líquido. Verifique as ressalvas contábeis abaixo."}
                        </p>
                        
                        <div className="pt-4 grid grid-cols-3 gap-2 text-center">
                          <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                            <span className="block text-[9px] text-slate-400 uppercase font-bold tracking-wider">Ativo Total</span>
                            <span className="text-xs font-bold font-mono text-slate-800">{formatBRL(result.indicators.AtivoTotal)}</span>
                          </div>
                          <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                            <span className="block text-[9px] text-slate-400 uppercase font-bold tracking-wider">Passivo + PL</span>
                            <span className="text-xs font-bold font-mono text-slate-800">{formatBRL(result.indicators.PassivoTotalEPais)}</span>
                          </div>
                          <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                            <span className="block text-[9px] text-slate-400 uppercase font-bold tracking-wider">Diferença</span>
                            <span className={`text-xs font-bold font-mono ${Math.abs(result.indicators.DiferencaBalanco) > 0 ? "text-red-600 font-black" : "text-emerald-600"}`}>
                              {formatBRL(result.indicators.DiferencaBalanco)}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Confidence card */}
                  <div className="p-6 bg-white border border-slate-200 rounded-2xl flex flex-col justify-between print-card shadow-sm">
                    <div className="space-y-1">
                      <p className="text-[10px] font-bold text-slate-400 uppercase leading-none">Confiança na Extração</p>
                      <h3 className="text-base font-bold text-slate-800">Score de Interpretação</h3>
                      <div className="flex items-baseline space-x-2 pt-2">
                        <span className="text-4xl font-black text-indigo-600 font-display">
                          {result.extractedData.ConfiancaExtracao}%
                        </span>
                        <span className="text-[10px] font-bold text-slate-400 uppercase font-mono">Gemini IA</span>
                      </div>
                    </div>

                    <div className="w-full bg-slate-100 rounded-full h-2 mt-4">
                      <div 
                        className={`h-2 rounded-full ${
                          result.extractedData.ConfiancaExtracao >= 85 
                            ? "bg-emerald-500" 
                            : result.extractedData.ConfiancaExtracao >= 60 
                            ? "bg-amber-500" 
                            : "bg-red-500"
                        }`} 
                        style={{ width: `${result.extractedData.ConfiancaExtracao}%` }}
                      ></div>
                    </div>

                    <p className="text-[10px] text-slate-400 mt-3 leading-normal font-medium">
                      Calculado pelo Gemini com base na legibilidade de tabelas, fontes e identificação de subcontas no PDF enviado.
                    </p>
                  </div>
                </div>

                {/* Sub-accounts alerts & Unclassified accounts */}
                {(result.extractedData.ContasNaoClassificadas.length > 0 || result.extractedData.ObservacoesInconsistencias) && (
                  <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 grid grid-cols-1 md:grid-cols-2 gap-6 print-card">
                    {/* Unclassified accounts */}
                    {result.extractedData.ContasNaoClassificadas.length > 0 && (
                      <div className="space-y-2">
                        <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center">
                          <Info className="h-4 w-4 mr-1.5 text-slate-500" />
                          Contas Não Classificadas
                        </h4>
                        <p className="text-xs text-slate-500 font-medium">
                          Contas identificadas que necessitam de enquadramento ou são atípicas:
                        </p>
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {result.extractedData.ContasNaoClassificadas.map((c, i) => (
                            <span key={i} className="text-[11px] font-bold bg-white border border-slate-200 text-slate-700 px-2.5 py-1 rounded-md shadow-sm">
                              {c}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Observations / Inconsistencies */}
                    {result.extractedData.ObservacoesInconsistencias && (
                      <div className="space-y-2">
                        <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center">
                          <AlertTriangle className="h-4 w-4 mr-1.5 text-amber-600 animate-pulse" />
                          Observações e Inconsistências
                        </h4>
                        <p className="text-xs text-slate-600 bg-amber-50/50 p-3 rounded-lg border border-amber-100 italic leading-relaxed font-medium">
                          "{result.extractedData.ObservacoesInconsistencias}"
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* Raw accounting table mapping (Sleek Dark Theme) */}
                <div className="bg-slate-900 text-white rounded-2xl shadow-md border border-slate-800 p-6 print-card">
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 border-b border-slate-800 pb-2">
                    Grandes Grupos Contábeis Extraídos (Estrutura de Balancete)
                  </h3>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8 divide-y md:divide-y-0 md:divide-x divide-slate-800">
                    {/* Balanço Patrimonial */}
                    <div className="space-y-4">
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider pb-1">
                        Balanço Patrimonial (Saldos Patrimoniais)
                      </h4>
                      {/* Tabela Cabeçalho de Colunas */}
                      <div className="flex justify-between items-center text-[10px] font-mono text-slate-500 uppercase border-b border-slate-800 pb-2 mb-2 font-bold tracking-wider">
                        <span>GRUPO PATRIMONIAL</span>
                        <div className="flex items-center space-x-4 shrink-0">
                          {result.periodPrev && (
                            <span className="w-28 text-right text-indigo-400">
                              ANO: {result.periodPrev}
                            </span>
                          )}
                          <span className={`text-right text-indigo-400 font-extrabold ${result.periodPrev ? "w-28" : ""}`}>
                            ANO: {result.period}
                          </span>
                          {result.periodPrev && (
                            <span className="w-16 text-right text-indigo-400 pr-1">
                              VARIACÃO
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="space-y-1">
                        {renderAccountRow("Ativo Circulante (AC)", result.extractedData.AtivoCirculante, result.extractedDataPrev?.AtivoCirculante)}
                        {renderAccountRow("• Estoques", result.extractedData.Estoques, result.extractedDataPrev?.Estoques, "pl-4")}
                        {renderAccountRow("• Disponível (Caixa e Bancos)", result.extractedData.Disponivel, result.extractedDataPrev?.Disponivel, "pl-4")}
                        {renderAccountRow("Ativo Não Circulante (ANC)", result.extractedData.AtivoNaoCirculante, result.extractedDataPrev?.AtivoNaoCirculante)}
                        {renderAccountRow("• Imobilizado", result.extractedData.Imobilizado, result.extractedDataPrev?.Imobilizado, "pl-4")}
                        {renderTotalRow("SOMA DO ATIVO TOTAL", result.indicators.AtivoTotal, result.indicatorsPrev?.AtivoTotal)}
                      </div>

                      <div className="space-y-1 pt-4">
                        {renderAccountRow("Passivo Circulante (PC)", result.extractedData.PassivoCirculante, result.extractedDataPrev?.PassivoCirculante)}
                        {renderAccountRow("Passivo Não Circulante (PNC)", result.extractedData.PassivoNaoCirculante, result.extractedDataPrev?.PassivoNaoCirculante)}
                        {renderAccountRow("Patrimônio Líquido (PL)", result.extractedData.PatrimonioLiquido, result.extractedDataPrev?.PatrimonioLiquido)}
                        {renderTotalRow("SOMA DO PASSIVO + PL", result.indicators.PassivoTotalEPais, result.indicatorsPrev?.PassivoTotalEPais)}
                      </div>
                    </div>

                    {/* DRE */}
                    <div className="space-y-4 md:pl-8">
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider pb-1">
                        DRE (Demonstração de Resultados)
                      </h4>
                      {/* Tabela Cabeçalho de Colunas DRE */}
                      <div className="flex justify-between items-center text-[10px] font-mono text-slate-500 uppercase border-b border-slate-800 pb-2 mb-2 font-bold tracking-wider">
                        <span>CONTA / RECEITA</span>
                        <div className="flex items-center space-x-4 shrink-0">
                          {result.periodPrev && (
                            <span className="w-28 text-right text-indigo-400">
                              ANO: {result.periodPrev}
                            </span>
                          )}
                          <span className={`text-right text-indigo-400 font-extrabold ${result.periodPrev ? "w-28" : ""}`}>
                            ANO: {result.period}
                          </span>
                          {result.periodPrev && (
                            <span className="w-16 text-right text-indigo-400 pr-1">
                              VARIACÃO
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="space-y-1">
                        {renderAccountRow("Receita Bruta", result.extractedData.ReceitaBruta, result.extractedDataPrev?.ReceitaBruta)}
                        {renderAccountRow("Deduções de Impostos/Vendas", result.extractedData.Deducoes, result.extractedDataPrev?.Deducoes)}
                        {renderAccountRow("Receita Líquida", result.extractedData.ReceitaLiquida, result.extractedDataPrev?.ReceitaLiquida, "bg-slate-800/20 p-1 rounded")}
                        {renderAccountRow("Custos das Mercadorias/Produtos", result.extractedData.Custos, result.extractedDataPrev?.Custos)}
                        {renderAccountRow("Resultado Bruto", result.extractedData.ResultadoBruto, result.extractedDataPrev?.ResultadoBruto, "bg-slate-800/20 p-1 rounded")}
                        {renderAccountRow("Despesas Operacionais", result.extractedData.DespesasOperacionais, result.extractedDataPrev?.DespesasOperacionais)}
                        {renderAccountRow("Resultado Operacional (EBIT)", result.extractedData.ResultadoOperacional, result.extractedDataPrev?.ResultadoOperacional, "bg-slate-800/20 p-1 rounded")}
                        {renderTotalRow("RESULTADO LÍQUIDO (LUCRO)", result.extractedData.ResultadoLiquido, result.extractedDataPrev?.ResultadoLiquido, true)}
                      </div>
                    </div>
                  </div>
                  
                  <div className="mt-6 pt-4 border-t border-slate-800 text-center">
                    <p className="text-[10px] text-slate-500 italic">Confiança da Extração Gemini: {result.extractedData.ConfiancaExtracao}% | Baseado em dados estruturados (DRE/BP)</p>
                  </div>
                </div>
              </div>
            )}

            {/* 2. INDICADORES OBRIGATÓRIOS */}
            {(activeTab === "indicadores" || window.matchMedia("print").matches) && (
              <div className="space-y-8 print-container">
                {/* Liquidez Group */}
                <div className="space-y-4">
                  <h3 className="text-sm font-bold font-display text-slate-800 uppercase tracking-widest border-l-4 border-indigo-600 pl-2">
                    1. Grupo de Liquidez e Solvência
                  </h3>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Liquidez Corrente */}
                    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-3 print-card">
                      <div className="flex justify-between items-start">
                        <div>
                          <h4 className="text-xs font-bold text-slate-400 uppercase">Liquidez Corrente</h4>
                          <span className="text-3xl font-black font-mono text-indigo-600 block mt-1">
                            {result.indicators.LiquidezCorrente !== null ? result.indicators.LiquidezCorrente.toFixed(2) : "N/A"}
                          </span>
                        </div>
                        <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${getLiquidezRating(result.indicators.LiquidezCorrente).bg}`}>
                          {getLiquidezRating(result.indicators.LiquidezCorrente).rating}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-600 bg-slate-50 p-2.5 rounded border border-slate-200 font-mono space-y-1">
                        <div><strong>Fórmula:</strong> Ativo Circulante / Passivo Circulante</div>
                        <div><strong>Substituição:</strong> {formatBRL(result.extractedData.AtivoCirculante)} / {formatBRL(result.extractedData.PassivoCirculante)}</div>
                      </div>
                      <p className="text-xs text-slate-500 leading-relaxed font-medium">
                        Indica quanto a empresa possui de bens/direitos de curto prazo para saldar cada R$ 1,00 de dívida no mesmo período.
                      </p>
                    </div>

                    {/* Liquidez Seca */}
                    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-3 print-card">
                      <div className="flex justify-between items-start">
                        <div>
                          <h4 className="text-xs font-bold text-slate-400 uppercase">Liquidez Seca</h4>
                          <span className="text-3xl font-black font-mono text-indigo-600 block mt-1">
                            {result.indicators.LiquidezSeca !== null ? result.indicators.LiquidezSeca.toFixed(2) : "N/A"}
                          </span>
                        </div>
                        <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${getLiquidezSecaRating(result.indicators.LiquidezSeca).bg}`}>
                          {getLiquidezSecaRating(result.indicators.LiquidezSeca).rating}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-600 bg-slate-50 p-2.5 rounded border border-slate-200 font-mono space-y-1">
                        <div><strong>Fórmula:</strong> (Ativo Circulante − Estoques) / Passivo Circulante</div>
                        <div><strong>Substituição:</strong> ({formatBRL(result.extractedData.AtivoCirculante)} − {formatBRL(result.extractedData.Estoques)}) / {formatBRL(result.extractedData.PassivoCirculante)}</div>
                      </div>
                      <p className="text-xs text-slate-500 leading-relaxed font-medium">
                        Mede a capacidade de liquidação imediata deduzindo o estoque, que é considerado o Ativo Circulante mais lento para converter em dinheiro.
                      </p>
                    </div>

                    {/* Liquidez Imediata */}
                    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-3 print-card">
                      <div className="flex justify-between items-start">
                        <div>
                          <h4 className="text-xs font-bold text-slate-400 uppercase">Liquidez Imediata</h4>
                          <span className="text-3xl font-black font-mono text-indigo-600 block mt-1">
                            {result.indicators.LiquidezImediata !== null ? result.indicators.LiquidezImediata.toFixed(2) : "N/A"}
                          </span>
                        </div>
                        <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${getLiquidezImediataRating(result.indicators.LiquidezImediata).bg}`}>
                          {getLiquidezImediataRating(result.indicators.LiquidezImediata).rating}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-600 bg-slate-50 p-2.5 rounded border border-slate-200 font-mono space-y-1">
                        <div><strong>Fórmula:</strong> Disponível / Passivo Circulante</div>
                        <div><strong>Substituição:</strong> {formatBRL(result.extractedData.Disponivel)} / {formatBRL(result.extractedData.PassivoCirculante)}</div>
                      </div>
                      <p className="text-xs text-slate-500 leading-relaxed font-medium">
                        Mede o poder de quitação de dívidas imediatas utilizando apenas as disponibilidades em caixa e contas bancárias.
                      </p>
                    </div>

                    {/* Capital de Giro Líquido */}
                    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-3 print-card">
                      <div className="flex justify-between items-start">
                        <div>
                          <h4 className="text-xs font-bold text-slate-400 uppercase">Capital de Giro Líquido</h4>
                          <span className={`text-2xl font-black font-mono block mt-1 ${result.indicators.CapitalDeGiro >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                            {formatBRL(result.indicators.CapitalDeGiro)}
                          </span>
                        </div>
                        <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${result.indicators.CapitalDeGiro >= 0 ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>
                          {result.indicators.CapitalDeGiro >= 0 ? "Positivo" : "Déficit"}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-600 bg-slate-50 p-2.5 rounded border border-slate-200 font-mono space-y-1">
                        <div><strong>Fórmula:</strong> Ativo Circulante − Passivo Circulante</div>
                        <div><strong>Substituição:</strong> {formatBRL(result.extractedData.AtivoCirculante)} − {formatBRL(result.extractedData.PassivoCirculante)}</div>
                      </div>
                      <p className="text-xs text-slate-500 leading-relaxed font-medium">
                        Folga ou déficit financeiro de curto prazo da empresa. É o recurso financeiro livre disponível para operar.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Estrutura de Capital Group */}
                <div className="space-y-4 pt-4">
                  <h3 className="text-sm font-bold font-display text-slate-800 uppercase tracking-widest border-l-4 border-indigo-600 pl-2">
                    2. Estrutura de Capital e Endividamento
                  </h3>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Endividamento Geral */}
                    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-3 print-card">
                      <div className="flex justify-between items-start">
                        <div>
                          <h4 className="text-xs font-bold text-slate-400 uppercase">Endividamento Geral</h4>
                          <span className="text-2xl font-black font-mono text-slate-800 block mt-1">
                            {result.indicators.Endividamento !== null ? (result.indicators.Endividamento * 100).toFixed(1) + "%" : "N/A"}
                          </span>
                        </div>
                        <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${getEndividamentoRating(result.indicators.Endividamento).bg}`}>
                          {getEndividamentoRating(result.indicators.Endividamento).rating}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-600 bg-slate-50 p-2.5 rounded border border-slate-200 font-mono space-y-1">
                        <div><strong>Fórmula:</strong> Passivo Total / Ativo Total</div>
                        <div><strong>Substituição:</strong> {formatBRL(result.indicators.PassivoTotal)} / {formatBRL(result.indicators.AtivoTotal)}</div>
                      </div>
                      <p className="text-xs text-slate-500 leading-relaxed font-medium">
                        Mostra a porcentagem de todos os bens e direitos da organização financiados por capital de terceiros.
                      </p>
                    </div>

                    {/* Capital de Terceiros */}
                    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-3 print-card">
                      <div className="flex justify-between items-start">
                        <div>
                          <h4 className="text-xs font-bold text-slate-400 uppercase">Capital Terceiros / PL</h4>
                          <span className="text-2xl font-black font-mono text-slate-800 block mt-1">
                            {result.indicators.CapitalDeTerceiros !== null ? (result.indicators.CapitalDeTerceiros * 100).toFixed(1) + "%" : "N/A"}
                          </span>
                        </div>
                        <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${getTerceirosRating(result.indicators.CapitalDeTerceiros).bg}`}>
                          {getTerceirosRating(result.indicators.CapitalDeTerceiros).rating}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-600 bg-slate-50 p-2.5 rounded border border-slate-200 font-mono space-y-1">
                        <div><strong>Fórmula:</strong> Passivo Total / Patrimônio Líquido</div>
                        <div><strong>Substituição:</strong> {formatBRL(result.indicators.PassivoTotal)} / {formatBRL(result.extractedData.PatrimonioLiquido)}</div>
                      </div>
                      <p className="text-xs text-slate-500 leading-relaxed font-medium">
                        Mede a proporção do investimento de credores de terceiros em relação ao capital investido pelos proprietários (PL).
                      </p>
                    </div>

                    {/* Imobilização do PL */}
                    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-3 print-card">
                      <div className="flex justify-between items-start">
                        <div>
                          <h4 className="text-xs font-bold text-slate-400 uppercase">Imobilização do PL</h4>
                          <span className="text-2xl font-black font-mono text-slate-800 block mt-1">
                            {result.indicators.ImobilizacaoPL !== null ? (result.indicators.ImobilizacaoPL * 100).toFixed(1) + "%" : "N/A"}
                          </span>
                        </div>
                        <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${getImobilizacaoRating(result.indicators.ImobilizacaoPL).bg}`}>
                          {getImobilizacaoRating(result.indicators.ImobilizacaoPL).rating}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-600 bg-slate-50 p-2.5 rounded border border-slate-200 font-mono space-y-1">
                        <div><strong>Fórmula:</strong> Imobilizado / Patrimônio Líquido</div>
                        <div><strong>Substituição:</strong> {formatBRL(result.extractedData.Imobilizado)} / {formatBRL(result.extractedData.PatrimonioLiquido)}</div>
                      </div>
                      <p className="text-xs text-slate-500 leading-relaxed font-medium">
                        Revela a porcentagem do Patrimônio Líquido que está "travada" em ativos fixos (maquinário, imóveis, veículos).
                      </p>
                    </div>
                  </div>
                </div>

                {/* Margens e Rentabilidades Group */}
                <div className="space-y-4 pt-4">
                  <h3 className="text-sm font-bold font-display text-slate-800 uppercase tracking-widest border-l-4 border-indigo-600 pl-2">
                    3. Grupo de Margens e Retorno (Rentabilidade)
                  </h3>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Margem Bruta */}
                    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-3 print-card">
                      <div className="flex justify-between items-start">
                        <div>
                          <h4 className="text-xs font-bold text-slate-400 uppercase">Margem Bruta</h4>
                          <span className="text-2xl font-black font-mono text-emerald-600 block mt-1">
                            {result.indicators.MargemBruta !== null ? (result.indicators.MargemBruta * 100).toFixed(1) + "%" : "N/A"}
                          </span>
                        </div>
                        <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700">
                          Rentabilidade
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-600 bg-slate-50 p-2.5 rounded border border-slate-200 font-mono space-y-1">
                        <div><strong>Fórmula:</strong> Resultado Bruto / Receita Líquida</div>
                        <div><strong>Substituição:</strong> {formatBRL(result.extractedData.ResultadoBruto)} / {formatBRL(result.extractedData.ReceitaLiquida)}</div>
                      </div>
                      <p className="text-xs text-slate-500 leading-relaxed font-medium">
                        Representa o percentual que sobra da receita líquida após a dedução dos custos diretos de aquisição ou produção de bens/serviços.
                      </p>
                    </div>

                    {/* Margem Operacional */}
                    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-3 print-card">
                      <div className="flex justify-between items-start">
                        <div>
                          <h4 className="text-xs font-bold text-slate-400 uppercase">Margem Operacional</h4>
                          <span className="text-2xl font-black font-mono text-emerald-600 block mt-1">
                            {result.indicators.MargemOperacional !== null ? (result.indicators.MargemOperacional * 100).toFixed(1) + "%" : "N/A"}
                          </span>
                        </div>
                        <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700">
                          Operação
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-600 bg-slate-50 p-2.5 rounded border border-slate-200 font-mono space-y-1">
                        <div><strong>Fórmula:</strong> Resultado Operacional / Receita Líquida</div>
                        <div><strong>Substituição:</strong> {formatBRL(result.extractedData.ResultadoOperacional)} / {formatBRL(result.extractedData.ReceitaLiquida)}</div>
                      </div>
                      <p className="text-xs text-slate-500 leading-relaxed font-medium">
                        Expressa a eficiência operacional, apontando quanto a empresa lucra em suas operações centrais para cada real faturado líquido.
                      </p>
                    </div>

                    {/* Margem Líquida */}
                    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-3 print-card">
                      <div className="flex justify-between items-start">
                        <div>
                          <h4 className="text-xs font-bold text-slate-400 uppercase">Margem Líquida</h4>
                          <span className="text-2xl font-black font-mono text-emerald-600 block mt-1">
                            {result.indicators.MargemLiquida !== null ? (result.indicators.MargemLiquida * 100).toFixed(1) + "%" : "N/A"}
                          </span>
                        </div>
                        <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${getMargemRating(result.indicators.MargemLiquida).bg}`}>
                          {getMargemRating(result.indicators.MargemLiquida).rating}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-600 bg-slate-50 p-2.5 rounded border border-slate-200 font-mono space-y-1">
                        <div><strong>Fórmula:</strong> Lucro Líquido / Receita Líquida</div>
                        <div><strong>Substituição:</strong> {formatBRL(result.extractedData.ResultadoLiquido)} / {formatBRL(result.extractedData.ReceitaLiquida)}</div>
                      </div>
                      <p className="text-xs text-slate-500 leading-relaxed font-medium">
                        Mede a lucratividade líquida final obtida após deduzidos todos os custos, despesas operacionais, tributárias e financeiras.
                      </p>
                    </div>

                    {/* ROA */}
                    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-3 print-card">
                      <div className="flex justify-between items-start">
                        <div>
                          <h4 className="text-xs font-bold text-slate-400 uppercase">ROA (Retorno sobre Ativos)</h4>
                          <span className="text-2xl font-black font-mono text-indigo-600 block mt-1">
                            {result.indicators.ROA !== null ? (result.indicators.ROA * 100).toFixed(1) + "%" : "N/A"}
                          </span>
                        </div>
                        <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700">
                          Rentabilidade
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-600 bg-slate-50 p-2.5 rounded border border-slate-200 font-mono space-y-1">
                        <div><strong>Fórmula:</strong> Lucro Líquido / Ativo Total</div>
                        <div><strong>Substituição:</strong> {formatBRL(result.extractedData.ResultadoLiquido)} / {formatBRL(result.indicators.AtivoTotal)}</div>
                      </div>
                      <p className="text-xs text-slate-500 leading-relaxed font-medium">
                        Indica a eficiência da empresa em gerar lucro a partir de sua estrutura total de ativos (capacidade produtiva).
                      </p>
                    </div>

                    {/* ROE */}
                    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-3 md:col-span-2 print-card">
                      <div className="flex justify-between items-start">
                        <div>
                          <h4 className="text-xs font-bold text-slate-400 uppercase">ROE (Retorno sobre o PL)</h4>
                          <span className="text-3xl font-black font-mono text-indigo-600 block mt-1">
                            {result.indicators.ROE !== null ? (result.indicators.ROE * 100).toFixed(1) + "%" : "N/A"}
                          </span>
                        </div>
                        <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${result.indicators.ROE && result.indicators.ROE >= 0.15 ? "bg-emerald-100 text-emerald-800" : "bg-yellow-100 text-yellow-800"}`}>
                          {result.indicators.ROE && result.indicators.ROE >= 0.15 ? "Excelente" : "Abaixo da média"}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-600 bg-slate-50 p-2.5 rounded border border-slate-200 font-mono space-y-1">
                        <div><strong>Fórmula:</strong> Lucro Líquido / Patrimônio Líquido</div>
                        <div><strong>Substituição:</strong> {formatBRL(result.extractedData.ResultadoLiquido)} / {formatBRL(result.extractedData.PatrimonioLiquido)}</div>
                      </div>
                      <p className="text-xs text-slate-500 leading-relaxed font-medium">
                        O indicador mais visado por investidores e proprietários. Mede a taxa de retorno do capital investido pelos acionistas ou donos no negócio.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 3. GRÁFICOS DE DESEMPENHO */}
            {(activeTab === "graficos" || window.matchMedia("print").matches) && (
              <div className="space-y-8 print-container">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  {/* Chart 1: Liquidez */}
                  <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm print-card">
                    <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-4 flex items-center">
                      <Activity className="h-4 w-4 mr-1.5 text-indigo-600" />
                      Relação de Índices de Liquidez
                    </h3>
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={[
                            { name: "L. Corrente", valor: result.indicators.LiquidezCorrente || 0 },
                            { name: "L. Seca", valor: result.indicators.LiquidezSeca || 0 },
                            { name: "L. Imediata", valor: result.indicators.LiquidezImediata || 0 },
                          ]}
                          margin={{ top: 20, right: 10, left: -20, bottom: 5 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                          <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#64748b", fontWeight: 600 }} />
                          <YAxis tick={{ fontSize: 11, fill: "#64748b" }} />
                          <Tooltip formatter={(value: any) => [value.toFixed(2), "Índice"]} />
                          <ReferenceLine y={1.0} stroke="#ef4444" strokeDasharray="3 3" label={{ value: "Mínimo (1.0)", position: "insideBottomRight", fill: "#ef4444", fontSize: 9, fontWeight: 'bold' }} />
                          <Bar dataKey="valor" radius={[4, 4, 0, 0]}>
                            <Cell fill="#4338ca" />
                            <Cell fill="#6366f1" />
                            <Cell fill="#a5b4fc" />
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-2 text-center font-mono font-medium">
                      Valores de referência: acima de 1.0 expressa capacidade de quitação favorável.
                    </p>
                  </div>

                  {/* Chart 2: Composição do Ativo */}
                  <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm print-card">
                    <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-4 flex items-center">
                      <Percent className="h-4 w-4 mr-1.5 text-indigo-600" />
                      Composição Total do Ativo
                    </h3>
                    <div className="h-64 flex items-center justify-center">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={[
                              { name: "Ativo Circulante (Curto Prazo)", value: result.extractedData.AtivoCirculante },
                              { name: "Ativo Não Circulante (Longo Prazo)", value: result.extractedData.AtivoNaoCirculante },
                            ]}
                            cx="50%"
                            cy="50%"
                            innerRadius={60}
                            outerRadius={80}
                            paddingAngle={5}
                            dataKey="value"
                            label={({ name, percent }) => `${(percent * 100).toFixed(0)}%`}
                          >
                            <Cell fill="#4f46e5" />
                            <Cell fill="#c7d2fe" />
                          </Pie>
                          <Tooltip formatter={(value: any) => [formatBRL(value), "Valor"]} />
                          <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: 10, fontWeight: 500 }} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* Chart 3: Margens e Retornos */}
                  <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm print-card">
                    <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-4 flex items-center">
                      <TrendingUp className="h-4 w-4 mr-1.5 text-indigo-600" />
                      Margens Operacionais & Rentabilidades (%)
                    </h3>
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={[
                            { name: "Margem Bruta", valor: (result.indicators.MargemBruta || 0) * 100 },
                            { name: "Margem Oper.", valor: (result.indicators.MargemOperacional || 0) * 100 },
                            { name: "Margem Líq.", valor: (result.indicators.MargemLiquida || 0) * 100 },
                            { name: "ROA", valor: (result.indicators.ROA || 0) * 100 },
                            { name: "ROE", valor: (result.indicators.ROE || 0) * 100 },
                          ]}
                          margin={{ top: 20, right: 10, left: -20, bottom: 5 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                          <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#64748b", fontWeight: 600 }} />
                          <YAxis tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11, fill: "#64748b" }} />
                          <Tooltip formatter={(value: any) => [`${value.toFixed(1)}%`, "Percentual"]} />
                          <Bar dataKey="valor" radius={[4, 4, 0, 0]}>
                            {
                              [0,1,2,3,4].map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={index >= 3 ? "#4f46e5" : "#10b981"} />
                              ))
                            }
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* Chart 4: Evolução Comparativa Absoluta */}
                  <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm print-card">
                    <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-4 flex items-center">
                      <DollarSign className="h-4 w-4 mr-1.5 text-indigo-600" />
                      Estrutura de Resultados Absolutos {result.hasPrevious ? "Comparada" : ""}
                    </h3>
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={result.hasPrevious ? [
                            { 
                              name: "Receita Líquida", 
                              [result.periodPrev || "Anterior"]: result.extractedDataPrev?.ReceitaLiquida || 0, 
                              [result.period]: result.extractedData.ReceitaLiquida 
                            },
                            { 
                              name: "Resultado Líquido", 
                              [result.periodPrev || "Anterior"]: result.extractedDataPrev?.ResultadoLiquido || 0, 
                              [result.period]: result.extractedData.ResultadoLiquido 
                            },
                            { 
                              name: "Passivo Total", 
                              [result.periodPrev || "Anterior"]: result.indicatorsPrev?.PassivoTotal || 0, 
                              [result.period]: result.indicators.PassivoTotal 
                            },
                          ] : [
                            { name: "Receita Líquida", valor: result.extractedData.ReceitaLiquida },
                            { name: "Resultado Líquido", valor: result.extractedData.ResultadoLiquido },
                            { name: "Passivo Total", valor: result.indicators.PassivoTotal },
                          ]}
                          margin={{ top: 20, right: 10, left: 10, bottom: 5 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                          <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#64748b", fontWeight: 600 }} />
                          <YAxis tickFormatter={(v) => `R$ ${(v/1000).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}k`} tick={{ fontSize: 10, fill: "#64748b" }} />
                          <Tooltip formatter={(value: any) => [formatBRL(value), "Valor"]} />
                          {result.hasPrevious ? (
                            <>
                              <Legend verticalAlign="top" height={36} iconType="circle" wrapperStyle={{ fontSize: 10, fontWeight: 500 }} />
                              <Bar dataKey={result.periodPrev || "Anterior"} fill="#94a3b8" radius={[4, 4, 0, 0]} />
                              <Bar dataKey={result.period} fill="#4f46e5" radius={[4, 4, 0, 0]} />
                            </>
                          ) : (
                            <Bar dataKey="valor" radius={[4, 4, 0, 0]}>
                              <Cell fill="#4338ca" />
                              <Cell fill="#10b981" />
                              <Cell fill="#f59e0b" />
                            </Bar>
                          )}
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 4. MAPA DE RISCOS */}
            {(activeTab === "riscos" || window.matchMedia("print").matches) && (
              <div className="space-y-6 print-container">
                <div className="bg-slate-900 text-white rounded-2xl p-6 shadow-sm print-card">
                  <h3 className="text-lg font-bold font-display flex items-center tracking-wide">
                    <ShieldAlert className="h-5 w-5 mr-2 text-rose-500 animate-pulse" />
                    MAPA DE RISCOS ECONÔMICO-FINANCEIROS
                  </h3>
                  <p className="text-xs text-slate-300 mt-1 uppercase font-mono tracking-wider">
                    Classificação determinística de exposição a riscos corporativos estruturados por grupos patrimoniais.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {/* Liquidez Risk */}
                  <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col justify-between print-card">
                    <div className="space-y-3">
                      <div className="flex justify-between items-center pb-2 border-b border-slate-100">
                        <span className="text-xs font-bold text-slate-700 uppercase">Liquidez</span>
                        <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${
                          !result.indicators.LiquidezCorrente || result.indicators.LiquidezCorrente < 1.0 
                            ? "bg-red-100 text-red-800" 
                            : result.indicators.LiquidezCorrente < 1.5 
                            ? "bg-amber-100 text-amber-800" 
                            : "bg-emerald-100 text-emerald-800"
                        }`}>
                          {!result.indicators.LiquidezCorrente || result.indicators.LiquidezCorrente < 1.0 
                            ? "Crítico" 
                            : result.indicators.LiquidezCorrente < 1.5 
                            ? "Relevante" 
                            : "Baixo"}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 leading-relaxed font-medium">
                        Mede o risco de incapacidade de pagamento de obrigações em curto prazo. 
                        Seu índice de Liquidez Corrente atual é de <strong>{result.indicators.LiquidezCorrente?.toFixed(2) || "N/A"}</strong>.
                      </p>
                    </div>
                    <div className="text-[11px] font-bold text-slate-400 mt-4 font-mono uppercase tracking-wider">
                      Risco de Caixa imediato
                    </div>
                  </div>

                  {/* Endividamento Risk */}
                  <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col justify-between print-card">
                    <div className="space-y-3">
                      <div className="flex justify-between items-center pb-2 border-b border-slate-100">
                        <span className="text-xs font-bold text-slate-700 uppercase">Endividamento</span>
                        <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${
                          result.indicators.Endividamento && result.indicators.Endividamento > 0.7 
                            ? "bg-red-100 text-red-800" 
                            : result.indicators.Endividamento && result.indicators.Endividamento > 0.5 
                            ? "bg-amber-100 text-amber-800" 
                            : "bg-emerald-100 text-emerald-800"
                        }`}>
                          {result.indicators.Endividamento && result.indicators.Endividamento > 0.7 
                            ? "Crítico" 
                            : result.indicators.Endividamento && result.indicators.Endividamento > 0.5 
                            ? "Moderado" 
                            : "Baixo"}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 leading-relaxed font-medium">
                        Avalia o risco de dependência excessiva de recursos de terceiros (bancos, fornecedores). 
                        Endividamento Geral em <strong>{result.indicators.Endividamento ? (result.indicators.Endividamento * 100).toFixed(1) + "%" : "N/A"}</strong>.
                      </p>
                    </div>
                    <div className="text-[11px] font-bold text-slate-400 mt-4 font-mono uppercase tracking-wider">
                      Estrutura de Capital
                    </div>
                  </div>

                  {/* Rentabilidade Risk */}
                  <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col justify-between print-card">
                    <div className="space-y-3">
                      <div className="flex justify-between items-center pb-2 border-b border-slate-100">
                        <span className="text-xs font-bold text-slate-700 uppercase">Rentabilidade</span>
                        <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${
                          result.indicators.MargemLiquida && result.indicators.MargemLiquida < 0.03 
                            ? "bg-red-100 text-red-800" 
                            : result.indicators.MargemLiquida && result.indicators.MargemLiquida < 0.10 
                            ? "bg-amber-100 text-amber-800" 
                            : "bg-emerald-100 text-emerald-800"
                        }`}>
                          {result.indicators.MargemLiquida && result.indicators.MargemLiquida < 0.03 
                            ? "Crítico" 
                            : result.indicators.MargemLiquida && result.indicators.MargemLiquida < 0.10 
                            ? "Moderado" 
                            : "Baixo"}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 leading-relaxed font-medium">
                        Mapeia se o faturamento líquido gera lucro suficiente para amortizar riscos de mercado. 
                        Margem Líquida atual de <strong>{result.indicators.MargemLiquida ? (result.indicators.MargemLiquida * 100).toFixed(1) + "%" : "N/A"}</strong>.
                      </p>
                    </div>
                    <div className="text-[11px] font-bold text-slate-400 mt-4 font-mono uppercase tracking-wider">
                      Eficiência de Retornos
                    </div>
                  </div>

                  {/* Operacional Risk */}
                  <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col justify-between print-card">
                    <div className="space-y-3">
                      <div className="flex justify-between items-center pb-2 border-b border-slate-100">
                        <span className="text-xs font-bold text-slate-700 uppercase">Operacional</span>
                        <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${
                          result.extractedData.Custos > result.extractedData.ReceitaLiquida * 0.8 
                            ? "bg-red-100 text-red-800" 
                            : "bg-amber-100 text-amber-800"
                        }`}>
                          {result.extractedData.Custos > result.extractedData.ReceitaLiquida * 0.8 ? "Crítico" : "Moderado"}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 leading-relaxed font-medium">
                        Risco de custos de produção/vendas drenarem a maior parte do resultado operacional. 
                        Margem Bruta calculada em <strong>{result.indicators.MargemBruta ? (result.indicators.MargemBruta * 100).toFixed(1) + "%" : "N/A"}</strong>.
                      </p>
                    </div>
                    <div className="text-[11px] font-bold text-slate-400 mt-4 font-mono uppercase tracking-wider">
                      Custos de Operação
                    </div>
                  </div>

                  {/* Patrimonial Risk */}
                  <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col justify-between print-card">
                    <div className="space-y-3">
                      <div className="flex justify-between items-center pb-2 border-b border-slate-100">
                        <span className="text-xs font-bold text-slate-700 uppercase">Patrimonial</span>
                        <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${
                          result.indicators.ImobilizacaoPL && result.indicators.ImobilizacaoPL > 1.0 
                            ? "bg-red-100 text-red-800" 
                            : "bg-emerald-100 text-emerald-800"
                        }`}>
                          {result.indicators.ImobilizacaoPL && result.indicators.ImobilizacaoPL > 1.0 ? "Relevante" : "Baixo"}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 leading-relaxed font-medium">
                        Informa o grau de imobilização do PL. Valores maiores de 100% significam que a empresa imobilizou mais que seu próprio capital, dependendo de terceiros para o giro.
                      </p>
                    </div>
                    <div className="text-[11px] font-bold text-slate-400 mt-4 font-mono uppercase tracking-wider">
                      Patrimônio Líquido
                    </div>
                  </div>

                  {/* Geral Risk Summary */}
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 flex flex-col justify-between print-card">
                    <div className="space-y-2">
                      <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Consistência Geral</h4>
                      <p className="text-xs text-slate-600 leading-relaxed font-medium">
                        O algoritmo contábil identificou que o balanço patrimonial está <strong>{result.indicators.BalancoConsistente ? "CONGRUENTE" : "DIVERGENTE"}</strong>. 
                        A prioridade imediata deve focar no grupo de <strong>Liquidez</strong> caso algum índice esteja abaixo de 1.0.
                      </p>
                    </div>
                    <div className="bg-white p-2.5 border border-slate-200 rounded text-center text-xs font-mono font-bold text-slate-800 uppercase tracking-wide">
                      {result.indicators.BalancoConsistente ? "✓ BAIXO RISCO SISTÊMICO" : "⚠ ATENÇÃO SISTÊMICA"}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 5. MEMORANDO EXECUTIVO */}
            {(activeTab === "memorando" || window.matchMedia("print").matches) && (
              <div className="space-y-6 print-container print-break">
                {/* Visual Paper Document container */}
                <div className="bg-white border border-slate-200 rounded-2xl shadow-md p-6 sm:p-10 max-w-4xl mx-auto print-card">
                  {/* Cover/Memo Header */}
                  <div className="border-b-2 border-indigo-600 pb-6 mb-8 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                    <div>
                      <h3 className="text-xl font-black uppercase tracking-wider font-display text-slate-900">
                        Memorando de Análise Financeira
                      </h3>
                      <p className="text-[10px] text-slate-400 font-mono mt-1 font-bold tracking-widest uppercase">
                        CONFIDENCIAL • DOCUMENTO INTERNO PARA TOMADA DE DECISÃO
                      </p>
                    </div>
                    <div className="text-right text-xs font-mono text-slate-500 font-bold uppercase">
                      <div>Data: {new Date().toLocaleDateString("pt-BR")}</div>
                      <div>Destinatário: Diretoria / Proprietário</div>
                    </div>
                  </div>

                  {/* Markdown Renderer Block */}
                  <div className="markdown-body prose prose-slate max-w-none text-sm text-slate-800 leading-relaxed space-y-4 font-sans">
                    <ReactMarkdown>{result.reportMarkdown}</ReactMarkdown>
                  </div>

                  {/* Corporate Footer Signoff */}
                  <div className="border-t border-slate-200 mt-12 pt-6 text-center text-[10px] text-slate-400 font-mono font-medium uppercase tracking-wide leading-relaxed">
                    Este memorando foi gerado de forma autônoma pela Inteligência Artificial do Analista Financeiro de Balancetes, 
                    correlacionando os dados lidos e cálculos determinísticos padronizados pela Lei das S.A. e práticas de controladoria.
                  </div>
                </div>
              </div>
            )}

            {/* Bottom print CTA (Hidden on Print) */}
            <div className="no-print bg-gradient-to-r from-indigo-900 to-indigo-950 text-white rounded-2xl p-6 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-4">
              <div>
                <h4 className="text-sm font-bold font-display uppercase tracking-wider">Pronto para apresentar à sua equipe ou banco?</h4>
                <p className="text-xs text-indigo-200 mt-0.5">
                  A visualização de impressão remove controles, abas e otimiza as quebras de página para um PDF limpo.
                </p>
              </div>
              <button
                onClick={handlePrint}
                className="py-2.5 px-5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold uppercase tracking-wider flex items-center space-x-2 transition-all cursor-pointer shadow-lg hover:shadow-indigo-500/20"
              >
                <Printer className="h-4 w-4" />
                <span>Gerar PDF / Imprimir</span>
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Footer (Hidden on Print) */}
      <footer className="no-print bg-white border-t border-slate-200 mt-16 py-8 text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-4 text-center md:text-left">
          <p className="font-bold text-slate-400 uppercase tracking-wider">© {new Date().getFullYear()} ANALISTA FINANCEIRO DE BALANCETES.</p>
          <p className="font-mono text-[10px] text-slate-400 font-medium uppercase tracking-wider">
            Segurança de Dados: Processamento em tempo de execução sem armazenamento local persistente de PDFs.
          </p>
        </div>
      </footer>
    </div>
  );
}
