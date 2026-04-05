"use client";

import { useState } from "react";

// MOCK — substituir por dados reais
const MOCK_BREACHES = [
  { category: "Moradia", budget: 5000, spent: 6062, pct: 121 },
  { category: "Lazer", budget: 1000, spent: 1200, pct: 120 },
  { category: "Alimentação", budget: 3500, spent: 3800, pct: 109 },
];

// MOCK — substituir por dados reais
const MOCK_RECOMMENDATIONS = [
  {
    type: "warning" as const,
    text: "Moradia consumiu 33% da renda — considere revisar o orçamento ou reduzir despesas variáveis nessa categoria",
  },
  {
    type: "info" as const,
    text: "Padrão identificado: compras no Assaí Atacadista toda última semana do mês — R$ 700 em média",
  },
  {
    type: "success" as const,
    text: "Transporte manteve-se 15% abaixo da média dos últimos 3 meses — bom controle",
  },
  {
    type: "warning" as const,
    text: "3 gastos em Lazer no fim de semana de 28-30/03 totalizam R$ 1.200 — acima do padrão semanal",
  },
];

// MOCK — substituir por dados reais
const MOCK_BUDGET_BARS = [
  { label: "Essenciais (Moradia, Contas)", spent: 3200, budget: 4500, pct: 71, color: "#063669" },
  { label: "Alimentação & Supermercado", spent: 1850, budget: 2000, pct: 92, color: "#006c49" },
  { label: "Transporte & Mobilidade", spent: 420, budget: 800, pct: 52, color: "#063669" },
  { label: "Lazer & Estilo de Vida", spent: 1150, budget: 1000, pct: 115, color: "#ba1a1a" },
];

// MOCK — substituir por dados reais
const MOCK_SUBSCRIPTIONS = [
  { name: "Paramount+", code: "P+", amount: 19.90, bg: "#dbeafe", color: "#1d4ed8" },
  { name: "Deezer Premium", code: "DZ", amount: 24.90, bg: "#f3e8ff", color: "#7c3aed" },
];

// MOCK — substituir por dados reais
const MOCK_ACTIVITY = [
  {
    icon: "receipt",
    bg: "#eff4ff",
    color: "#063669",
    title: "Categorização Automática",
    desc: 'Transação "Uber *Trip" movida de "Outros" para "Transporte".',
    time: "Hoje, 09:41",
  },
  {
    icon: "check",
    bg: "rgba(0,108,73,0.08)",
    color: "#006c49",
    title: "Meta de Reserva Atingida",
    desc: 'Você atingiu 100% da sua meta "Fundo de Emergência".',
    time: "Ontem, 18:20",
  },
  {
    icon: "alert",
    bg: "rgba(245,158,11,0.08)",
    color: "#d97706",
    title: "Alerta de Vencimento",
    desc: "Fatura do Cartão Platinum vence em 48h. Saldo disponível para pagamento.",
    time: "12 Jun, 10:15",
  },
];

const brl = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);

function ActivityIcon({ type }: { type: string }) {
  if (type === "receipt")
    return (
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
    );
  if (type === "check")
    return (
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
    );
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
  );
}

export default function AnalysisPage() {
  const [loading, setLoading] = useState(false);

  function handleReanalyze() {
    setLoading(true);
    setTimeout(() => setLoading(false), 2000);
  }

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Hero: AI Projection */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Projection card */}
        <div
          className="lg:col-span-2 relative overflow-hidden rounded-2xl p-10 flex flex-col justify-between"
          style={{ background: "#274e82", minHeight: 320 }}
        >
          <div
            className="absolute top-0 right-0 w-64 h-64 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none"
            style={{ background: "rgba(108,248,187,0.12)" }}
          />
          <div className="relative z-10">
            <span
              className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-widest mb-6 inline-block"
              style={{ background: "rgba(255,255,255,0.1)", color: "#9cc0fb" }}
            >
              Previsão Mensal
            </span>
            <h3 className="font-medium mb-1 text-sm" style={{ color: "rgba(255,255,255,0.7)" }}>
              Saldo Projetado para o final de Abril
            </h3>
            <div className="flex items-baseline gap-3">
              <p
                className="text-5xl font-extrabold tracking-tighter text-white"
                style={{ fontFamily: "var(--font-manrope), Manrope, sans-serif" }}
              >
                {brl(14280.50)}
              </p>
              <span className="font-bold flex items-center text-lg" style={{ color: "#6cf8bb" }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
                +12.4%
              </span>
            </div>
          </div>
          <div className="relative z-10 mt-8 grid grid-cols-3 gap-8">
            {[
              { label: "Entradas Previstas", value: "R$ 22.400" },
              { label: "Gastos Estimados", value: "R$ 8.119" },
              { label: "Taxa de Poupança", value: "36.2%" },
            ].map((stat) => (
              <div key={stat.label}>
                <p className="text-xs mb-1" style={{ color: "rgba(255,255,255,0.6)" }}>{stat.label}</p>
                <p
                  className="font-bold text-lg text-white"
                  style={{ fontFamily: "var(--font-manrope), Manrope, sans-serif" }}
                >
                  {stat.value}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Critical alert card */}
        <div
          className="rounded-2xl p-8 flex flex-col justify-between"
          style={{ background: "rgba(255,218,214,0.4)" }}
        >
          <div>
            <div className="flex items-center gap-2 mb-4" style={{ color: "#ba1a1a" }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="#ba1a1a" stroke="#ba1a1a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              <span className="font-bold text-xs uppercase tracking-wider">Aviso Crítico</span>
            </div>
            <h4
              className="text-xl font-bold leading-tight mb-3"
              style={{ fontFamily: "var(--font-manrope), Manrope, sans-serif", color: "#93000a" }}
            >
              Desvio em "Lazer e Jantares"
            </h4>
            <p className="text-sm leading-relaxed" style={{ color: "rgba(147,0,10,0.8)" }}>
              Seus gastos nesta categoria excederam a média dos últimos 3 meses em 45% nos primeiros 10 dias.
            </p>
          </div>
          <button
            className="mt-6 w-full py-3 font-bold rounded-lg text-sm transition-opacity hover:opacity-90"
            style={{ background: "#ba1a1a", color: "#ffffff" }}
          >
            Ajustar Orçamento
          </button>
        </div>
      </section>

      {/* Bento grid — Insights */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Subscriptions — double wide */}
        <div
          className="md:col-span-2 rounded-xl p-6 border group"
          style={{ background: "#ffffff", borderColor: "rgba(195,198,213,0.15)" }}
        >
          <div className="flex justify-between items-start mb-6">
            <div className="p-3 rounded-xl" style={{ background: "#eff4ff" }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#063669" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
            </div>
            <span
              className="text-[10px] font-bold px-2 py-1 rounded"
              style={{ background: "#eff4ff", color: "#737784" }}
            >
              FREQUÊNCIA BAIXA
            </span>
          </div>
          <h4
            className="text-lg font-bold mb-2"
            style={{ fontFamily: "var(--font-manrope), Manrope, sans-serif", color: "#0b1c30" }}
          >
            Assinaturas Ociosas
          </h4>
          <p className="text-sm leading-relaxed mb-6" style={{ color: "#434653" }}>
            Detectamos que você não utiliza os serviços{" "}
            <strong>Paramount+</strong> e <strong>Deezer</strong> há mais de 45 dias.
          </p>
          <div className="space-y-3">
            {MOCK_SUBSCRIPTIONS.map((s) => (
              <div
                key={s.name}
                className="flex items-center justify-between p-3 rounded-lg"
                style={{ background: "#eff4ff" }}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-8 h-8 rounded flex items-center justify-center font-black text-[10px]"
                    style={{ background: s.bg, color: s.color }}
                  >
                    {s.code}
                  </div>
                  <span className="text-xs font-bold" style={{ color: "#0b1c30" }}>{s.name}</span>
                </div>
                <span className="text-xs font-bold" style={{ fontFamily: "var(--font-manrope), Manrope, sans-serif", color: "#0b1c30" }}>
                  {brl(s.amount)}/mês
                </span>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs font-medium flex items-center gap-1" style={{ color: "#006c49" }}>
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
            Economia potencial de {brl((MOCK_SUBSCRIPTIONS.reduce((s, sub) => s + sub.amount, 0)) * 12)}/ano
          </p>
        </div>

        {/* Investment opportunity */}
        <div
          className="rounded-xl p-6 border"
          style={{ background: "#ffffff", borderColor: "rgba(195,198,213,0.15)" }}
        >
          <div
            className="p-3 w-fit rounded-xl mb-4"
            style={{ background: "rgba(108,248,187,0.2)", color: "#006c49" }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>
          </div>
          <h4
            className="text-lg font-bold mb-2"
            style={{ fontFamily: "var(--font-manrope), Manrope, sans-serif", color: "#0b1c30" }}
          >
            Oportunidade de Taxa
          </h4>
          <p className="text-sm leading-relaxed" style={{ color: "#434653" }}>
            Seu saldo parado em conta corrente ({brl(5400)}) poderia render{" "}
            <strong>{brl(28.5)}</strong> extras este mês em CDB 100% CDI.
          </p>
          <button className="mt-6 text-sm font-bold flex items-center gap-1 hover:underline" style={{ color: "#063669" }}>
            Alocar agora
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
          </button>
        </div>

        {/* AI tip */}
        <div
          className="rounded-xl p-6 border flex flex-col justify-between"
          style={{ background: "#ffffff", borderColor: "rgba(195,198,213,0.15)" }}
        >
          <div>
            <div
              className="p-3 w-fit rounded-xl mb-4"
              style={{ background: "#dae2fd", color: "#063669" }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            </div>
            <h4
              className="text-lg font-bold mb-2"
              style={{ fontFamily: "var(--font-manrope), Manrope, sans-serif", color: "#0b1c30" }}
            >
              Dica do Dia
            </h4>
            <p className="text-sm leading-relaxed italic" style={{ color: "#434653" }}>
              "Tente concentrar suas compras de mercado às quartas-feiras. O histórico mostra que você gasta 12% menos em dias de promoções de hortifruti."
            </p>
          </div>
          <div className="mt-6 pt-4 border-t flex items-center gap-2" style={{ borderColor: "#eff4ff" }}>
            <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "#737784" }}>Isso foi útil?</span>
            <button className="transition-colors hover:opacity-70" style={{ color: "#c3c6d5" }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>
            </button>
            <button className="transition-colors hover:opacity-70" style={{ color: "#c3c6d5" }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10z"/><path d="M17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/></svg>
            </button>
          </div>
        </div>
      </section>

      {/* Budget execution */}
      <section className="rounded-xl p-8" style={{ background: "#eff4ff" }}>
        <div className="flex justify-between items-end mb-8">
          <div>
            <h3
              className="text-2xl font-bold"
              style={{ fontFamily: "var(--font-manrope), Manrope, sans-serif", color: "#0b1c30" }}
            >
              Execução do Orçamento
            </h3>
            <p className="text-sm mt-1" style={{ color: "#434653" }}>
              Status atual em relação às metas definidas para Abril.
            </p>
          </div>
          <div className="text-right flex items-center gap-4">
            <div>
              <p className="text-xs uppercase font-bold tracking-widest mb-1" style={{ color: "#737784" }}>Total Utilizado</p>
              <p
                className="text-2xl font-bold"
                style={{ fontFamily: "var(--font-manrope), Manrope, sans-serif", color: "#063669" }}
              >
                64% <span className="text-sm font-normal" style={{ color: "#737784" }}>do teto</span>
              </p>
            </div>
            <button
              type="button"
              onClick={handleReanalyze}
              disabled={loading}
              className="rounded-xl px-4 py-2 text-sm font-bold border transition-opacity hover:opacity-80 disabled:opacity-50"
              style={{ color: "#063669", borderColor: "rgba(6,54,105,0.25)", background: "rgba(255,255,255,0.7)" }}
            >
              {loading ? "Analisando..." : "Nova análise"}
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-12 gap-y-8">
          {MOCK_BUDGET_BARS.map((b) => {
            const isOver = b.pct > 100;
            const isWarn = b.pct >= 85;
            const barColor = isOver ? "#ba1a1a" : isWarn ? "#f59e0b" : b.color;
            return (
              <div key={b.label} className="space-y-2">
                <div className="flex justify-between items-end">
                  <span className="text-sm font-bold" style={{ color: isOver ? "#ba1a1a" : "#0b1c30" }}>
                    {b.label}
                  </span>
                  <span
                    className="text-xs font-medium"
                    style={{ color: isOver ? "#ba1a1a" : "#434653" }}
                  >
                    {brl(b.spent)} de {brl(b.budget)}{isOver ? " (Excedido)" : ""}
                  </span>
                </div>
                <div className="h-3 w-full rounded-full overflow-hidden" style={{ background: "#ffffff" }}>
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${Math.min(b.pct, 100)}%`, background: barColor }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Activity feed */}
      <section className="rounded-xl p-8" style={{ background: "#ffffff" }}>
        <div className="flex items-center justify-between mb-8">
          <h3
            className="text-xl font-bold"
            style={{ fontFamily: "var(--font-manrope), Manrope, sans-serif", color: "#0b1c30" }}
          >
            Atividade Recente da IA
          </h3>
          <button className="text-xs font-bold hover:underline" style={{ color: "#063669" }}>
            Ver todo histórico
          </button>
        </div>
        <div className="space-y-1">
          {MOCK_ACTIVITY.map((item, i) => (
            <div
              key={i}
              className="flex items-center gap-6 p-4 rounded-lg transition-colors cursor-default"
              onMouseEnter={(e) => (e.currentTarget.style.background = "#eff4ff")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
                style={{ background: item.bg, color: item.color }}
              >
                <ActivityIcon type={item.icon} />
              </div>
              <div className="flex-1">
                <p className="text-sm font-bold" style={{ color: "#0b1c30" }}>{item.title}</p>
                <p className="text-xs" style={{ color: "#737784" }}>{item.desc}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-xs" style={{ color: "#737784" }}>{item.time}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Recommendations */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Budget alerts */}
        <div
          className="rounded-xl p-6 border"
          style={{ background: "#ffffff", borderColor: "rgba(195,198,213,0.15)" }}
        >
          <h2 className="mb-5 font-bold text-base" style={{ color: "#0b1c30" }}>
            Alertas de Orçamento
          </h2>
          <div className="space-y-5">
            {MOCK_BREACHES.map((b) => {
              const isOver = b.pct > 100;
              const barColor = isOver ? "#ba1a1a" : "#f59e0b";
              return (
                <div key={b.category}>
                  <div className="mb-1.5 flex items-center justify-between text-sm">
                    <span className="font-medium" style={{ color: "#0b1c30" }}>{b.category}</span>
                    <span className="tabular-nums font-bold" style={{ color: isOver ? "#ba1a1a" : "#d97706" }}>
                      {brl(b.spent)} / {brl(b.budget)} ({b.pct}%)
                    </span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full" style={{ background: "#eff4ff" }}>
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${Math.min(b.pct, 100)}%`, backgroundColor: barColor }}
                    />
                  </div>
                  {isOver && (
                    <p className="mt-1 text-xs font-medium" style={{ color: "#ba1a1a" }}>
                      Excedido em {brl(b.spent - b.budget)}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Recommendations */}
        <div
          className="rounded-xl p-6 border"
          style={{ background: "#ffffff", borderColor: "rgba(195,198,213,0.15)" }}
        >
          <h2 className="mb-5 font-bold text-base" style={{ color: "#0b1c30" }}>
            Recomendações
          </h2>
          <div className="space-y-3">
            {MOCK_RECOMMENDATIONS.map((r, i) => {
              const styles = {
                warning: { border: "#f59e0b", bg: "rgba(245,158,11,0.06)", prefix: "⚠", color: "#d97706" },
                info: { border: "#063669", bg: "rgba(6,54,105,0.06)", prefix: "ℹ", color: "#063669" },
                success: { border: "#006c49", bg: "rgba(0,108,73,0.06)", prefix: "✓", color: "#006c49" },
              }[r.type];
              return (
                <div
                  key={i}
                  className="rounded-r-lg py-3 pl-4 pr-4 border-l-4"
                  style={{ background: styles.bg, borderLeftColor: styles.border }}
                >
                  <div className="flex gap-2 text-sm">
                    <span className="shrink-0 font-bold" style={{ color: styles.color }}>{styles.prefix}</span>
                    <span style={{ color: "#434653" }}>{r.text}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
