"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, LineChart, Line, CartesianGrid,
} from "recharts";

type DashboardSummary = {
  month: string;
  monthly_salary: number;
  total_spent: number;
  total_income: number;
  spent_by_category: { category_id: string; total: number }[];
  budgets: { category_id: string; amount: number; month: string }[];
  alelo_budgets: {
    refeicao_budget: number;
    alimentacao_budget: number;
    spent_refeicao: number;
    spent_alimentacao: number;
  } | null;
  recent_transactions: { id: string; date: string; description: string; amount: number; category_id: string | null; source: string; bank: string | null }[];
  categories: { id: string; slug: string; label: string; color: string; icon: string | null }[];
  is_copy_forward: boolean;
};

const brl = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);

function currentMonthBounds() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const last = new Date(y, m, 0).getDate();
  const end = `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
  const label = now.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }).replace(". ", "/");
  return { start, end, label };
}

function last6MonthsBounds(): { start: string; label: string }[] {
  const result = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    result.push({
      start: `${y}-${String(m).padStart(2, "0")}-01`,
      label: d.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }).replace(". ", "/"),
    });
  }
  return result;
}

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) {
  if (active && payload?.length) {
    return (
      <div className="rounded-xl px-3 py-2 text-sm shadow-lg" style={{ background: "#ffffff", border: "1px solid #e5eeff", color: "#0b1c30" }}>
        <p className="mb-1 font-medium" style={{ color: "#434653" }}>{label}</p>
        <p className="font-bold">{brl(payload[0].value)}</p>
      </div>
    );
  }
  return null;
}

const BANK_COLORS: Record<string, string> = {
  itau: "#063669",
  alelo: "#006c49",
  btg: "#f59e0b",
  inter: "#ff7700",
};

const BANK_LABELS: Record<string, string> = {
  itau: "Itaú",
  alelo: "Alelo",
  btg: "BTG",
  inter: "Inter",
};

export default function DashboardOverviewPage() {
  const [reanalyzing, setReanalyzing] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`;
  });
  const { start, end, label: monthLabel } = useMemo(() => currentMonthBounds(), []);
  const months6 = useMemo(() => last6MonthsBounds(), []);

  const supabase = createClient();

  // Dashboard summary (orçamento + salário + alelo)
  const { data: summary } = useQuery<DashboardSummary>({
    queryKey: ["dashboard-summary", selectedMonth],
    queryFn: async () => {
      const res = await fetch(`/api/dashboard?month=${selectedMonth}`);
      if (!res.ok) throw new Error("Falha ao carregar dashboard");
      return res.json();
    },
  });

  // Auth
  const { data: userId } = useQuery({
    queryKey: ["auth-user-id"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      return user?.id ?? null;
    },
  });

  // Transactions this month
  const { data: transactions = [] } = useQuery({
    queryKey: ["dashboard-transactions", userId, start, end],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase
        .from("transactions")
        .select("amount, bank, category_id, date, source")
        .eq("user_id", userId!)
        .gte("date", start)
        .lte("date", end);
      return data ?? [];
    },
  });

  // Categories
  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      const { data } = await supabase.from("categories").select("id, slug, label, color, icon");
      return data ?? [];
    },
  });

  // Monthly totals last 6 months
  const { data: monthlyTotals = [] } = useQuery({
    queryKey: ["monthly-totals", userId, months6[0]?.start],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase
        .from("transactions")
        .select("amount, date")
        .eq("user_id", userId!)
        .gte("date", months6[0].start);
      return data ?? [];
    },
  });

  // LLM analysis (latest)
  const { data: llmAnalysis } = useQuery({
    queryKey: ["llm-analysis"],
    queryFn: async () => {
      const { data } = await supabase
        .from("llm_analyses")
        .select("content, created_at")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
  });

  // Computed: summary by bank
  const bankTotals = useMemo(() => {
    const map: Record<string, number> = {};
    for (const t of transactions) {
      const key = t.bank ?? "outros";
      map[key] = (map[key] ?? 0) + Number(t.amount);
    }
    return map;
  }, [transactions]);

  const totalMonth = useMemo(
    () => transactions.reduce((s, t) => s + Number(t.amount), 0),
    [transactions]
  );

  // Computed: by category
  const catMap = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories]
  );

  const categoryTotals = useMemo(() => {
    const map: Record<string, { label: string; total: number; icon: string }> = {};
    for (const t of transactions) {
      if (!t.category_id) continue;
      const cat = catMap.get(t.category_id);
      if (!cat) continue;
      if (!map[cat.slug]) map[cat.slug] = { label: cat.label, total: 0, icon: cat.icon ?? "" };
      map[cat.slug].total += Number(t.amount);
    }
    return Object.values(map)
      .sort((a, b) => b.total - a.total)
      .slice(0, 8);
  }, [transactions, catMap]);

  // Computed: monthly line chart
  const monthlyChartData = useMemo(() => {
    return months6.map(({ start: mStart, label }) => {
      const [y, m] = mStart.split("-").map(Number);
      const mEnd = new Date(y, m, 0);
      const endStr = `${y}-${String(m).padStart(2, "0")}-${String(mEnd.getDate()).padStart(2, "0")}`;
      const total = monthlyTotals
        .filter((t) => t.date >= mStart && t.date <= endStr)
        .reduce((s, t) => s + Number(t.amount), 0);
      return { mes: label, total };
    });
  }, [months6, monthlyTotals]);

  // Computed: budget breaches (category totals vs no budget defined → show top 4)
  const topCategories = categoryTotals.slice(0, 4);

  // Summary cards — mix local totals + API salary/alelo
  const salary = summary?.monthly_salary ?? 0;
  const aleloData = summary?.alelo_budgets;
  const saldoDisponivel = salary > 0 ? salary - totalMonth : null;
  const saldoVA = aleloData ? aleloData.alimentacao_budget - aleloData.spent_alimentacao : null;
  const saldoVR = aleloData ? aleloData.refeicao_budget - aleloData.spent_refeicao : null;

  const summaryCards = [
    { label: "Total do Mês", value: totalMonth, dot: "#063669", sub: null },
    ...(saldoDisponivel !== null ? [{ label: "Saldo Disponível", value: saldoDisponivel, dot: saldoDisponivel >= 0 ? "#006c49" : "#ba1a1a", sub: salary > 0 ? `Salário: ${brl(salary)}` : null }] : []),
    ...(saldoVA !== null ? [{ label: "Saldo VA", value: saldoVA, dot: "#006c49", sub: `Orçamento: ${brl(aleloData!.alimentacao_budget)}` }] : []),
    ...(saldoVR !== null ? [{ label: "Saldo VR", value: saldoVR, dot: "#f59e0b", sub: `Orçamento: ${brl(aleloData!.refeicao_budget)}` }] : []),
    ...Object.entries(bankTotals).map(([bank, value]) => ({
      label: BANK_LABELS[bank] ?? bank,
      value,
      dot: BANK_COLORS[bank] ?? "#737784",
      sub: null,
    })),
  ].slice(0, 4);

  // LLM insights parsed
  const insights: string[] = useMemo(() => {
    if (!llmAnalysis?.content) return [];
    try {
      const parsed = JSON.parse(llmAnalysis.content);
      if (Array.isArray(parsed.insights)) return parsed.insights.slice(0, 3);
      if (typeof parsed === "string") return [parsed];
    } catch {
      return [llmAnalysis.content].slice(0, 1);
    }
    return [];
  }, [llmAnalysis]);

  const llmDate = llmAnalysis?.created_at
    ? new Date(llmAnalysis.created_at).toLocaleDateString("pt-BR")
    : null;

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Hero */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 relative overflow-hidden rounded-2xl p-10 flex flex-col justify-between" style={{ background: "#274e82", minHeight: 240 }}>
          <div className="absolute top-0 right-0 w-64 h-64 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none" style={{ background: "rgba(108,248,187,0.12)" }} />
          <div className="relative z-10">
            <p className="font-medium mb-1 text-sm" style={{ color: "#9cc0fb" }}>Gastos em {monthLabel}</p>
            <h1 className="text-5xl font-extrabold tracking-tighter" style={{ fontFamily: "var(--font-manrope), Manrope, sans-serif", color: "#ffffff" }}>
              {brl(totalMonth)}
            </h1>
            <p className="mt-3 text-sm" style={{ color: "rgba(255,255,255,0.6)" }}>
              {transactions.length} lançamentos no período
            </p>
          </div>
          <div className="relative z-10 flex gap-4 mt-6">
            <a href="/dashboard/transactions" className="px-6 py-2 rounded-lg text-sm font-bold transition-opacity hover:opacity-90" style={{ background: "#006c49", color: "#ffffff" }}>
              Ver extrato
            </a>
            <a href="/dashboard/import" className="px-6 py-2 rounded-lg text-sm font-bold border" style={{ background: "rgba(255,255,255,0.1)", color: "#ffffff", borderColor: "rgba(255,255,255,0.2)" }}>
              Importar PDF
            </a>
          </div>
        </div>

        <div className="rounded-2xl p-6 border flex flex-col justify-between" style={{ background: "#eff4ff", borderColor: "rgba(195,198,213,0.1)" }}>
          <div>
            <div className="flex items-center gap-2 mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#063669" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2z"/></svg>
              <h3 className="font-bold" style={{ color: "#063669" }}>Insight do Dia</h3>
            </div>
            {insights.length > 0 ? (
              <p className="text-sm leading-relaxed" style={{ color: "#434653" }}>{insights[0]}</p>
            ) : (
              <p className="text-sm leading-relaxed" style={{ color: "#737784" }}>
                {transactions.length === 0
                  ? "Importe seus extratos para começar a receber análises."
                  : "Análise IA ainda não gerada. Acesse Análise IA para gerar."}
              </p>
            )}
          </div>
          <a href="/dashboard/analysis" className="mt-6 text-sm font-bold flex items-center gap-1 hover:underline" style={{ color: "#063669" }}>
            Ver análise completa
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
          </a>
        </div>
      </section>

      {/* Summary cards */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {summaryCards.map((card) => (
          <div key={card.label} className="rounded-xl p-6 border" style={{ background: "#ffffff", borderColor: "rgba(195,198,213,0.15)" }}>
            <div className="flex justify-between items-start mb-4">
              <div className="p-2.5 rounded-lg" style={{ background: "#eff4ff" }}>
                <span className="inline-block w-4 h-4 rounded-full" style={{ backgroundColor: card.dot }} />
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "#737784" }}>{card.label}</span>
            </div>
            {card.sub && <p className="text-xs mb-1" style={{ color: "#737784" }}>{card.sub}</p>}
            <h4 className="text-2xl font-bold" style={{ fontFamily: "var(--font-manrope), Manrope, sans-serif", color: card.label === "Saldo Disponível" && card.value < 0 ? "#ba1a1a" : "#0b1c30" }}>
              {brl(card.value)}
            </h4>
          </div>
        ))}
      </section>

      {/* Charts */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-xl p-6 border" style={{ background: "#ffffff", borderColor: "rgba(195,198,213,0.15)" }}>
          <div className="flex justify-between items-center mb-6">
            <h3 className="font-bold text-base" style={{ color: "#0b1c30" }}>Gasto por Categoria</h3>
            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#737784" }}>{monthLabel}</span>
          </div>
          {categoryTotals.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={categoryTotals} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid horizontal={false} stroke="#e5eeff" />
                <XAxis type="number" tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} tick={{ fill: "#737784", fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="label" width={90} tick={{ fill: "#737784", fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: "#eff4ff" }} />
                <Bar dataKey="total" fill="#063669" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-64 flex items-center justify-center text-sm" style={{ color: "#737784" }}>
              Nenhum dado no período
            </div>
          )}
        </div>

        <div className="rounded-xl p-6 border" style={{ background: "#ffffff", borderColor: "rgba(195,198,213,0.15)" }}>
          <div className="flex justify-between items-center mb-6">
            <h3 className="font-bold text-base" style={{ color: "#0b1c30" }}>Evolução Mensal</h3>
            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#737784" }}>Últimos 6 meses</span>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={monthlyChartData} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
              <CartesianGrid stroke="#e5eeff" />
              <XAxis dataKey="mes" tick={{ fill: "#737784", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} tick={{ fill: "#737784", fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip content={<CustomTooltip />} />
              <Line type="monotone" dataKey="total" stroke="#063669" strokeWidth={2} dot={{ fill: "#a7c8ff", r: 4, strokeWidth: 0 }} activeDot={{ fill: "#063669", r: 5, strokeWidth: 0 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Top categories execution */}
      {topCategories.length > 0 && (
        <section className="rounded-xl p-8" style={{ background: "#eff4ff" }}>
          <div className="flex justify-between items-end mb-8">
            <div>
              <h3 className="text-2xl font-bold" style={{ fontFamily: "var(--font-manrope), Manrope, sans-serif", color: "#0b1c30" }}>
                Top Categorias
              </h3>
              <p className="text-sm mt-1" style={{ color: "#434653" }}>Maiores despesas de {monthLabel}.</p>
            </div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-12 gap-y-8">
            {topCategories.map((c) => {
              const maxInSet = Math.max(...topCategories.map((x) => x.total));
              const pct = maxInSet > 0 ? Math.round((c.total / maxInSet) * 100) : 0;
              return (
                <div key={c.label} className="space-y-2">
                  <div className="flex justify-between items-end">
                    <span className="text-sm font-bold flex items-center gap-2" style={{ color: "#0b1c30" }}>
                      <span>{c.icon}</span>{c.label}
                    </span>
                    <span className="text-xs font-medium" style={{ color: "#434653" }}>{brl(c.total)}</span>
                  </div>
                  <div className="h-3 w-full rounded-full overflow-hidden" style={{ background: "#ffffff" }}>
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "#063669" }} />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Budget vs Gasto por Categoria */}
      {summary && (summary.budgets.length > 0 || summary.spent_by_category.length > 0) && (() => {
        const catMap = new Map(summary.categories.map(c => [c.id, c]));
        const budgetMap = new Map(summary.budgets.map(b => [b.category_id, b.amount]));
        // union de categorias com gasto ou orçamento
        const allCatIds = Array.from(new Set([
          ...summary.spent_by_category.map(s => s.category_id),
          ...summary.budgets.map(b => b.category_id),
        ]));
        const rows = allCatIds.map(cid => {
          const cat = catMap.get(cid);
          const spent = summary.spent_by_category.find(s => s.category_id === cid)?.total ?? 0;
          const budget = budgetMap.get(cid) ?? 0;
          const pct = budget > 0 ? Math.min((spent / budget) * 100, 999) : null;
          const status = pct === null ? null : pct > 100 ? "excedido" : pct >= 80 ? "atencao" : "ok";
          return { cid, cat, spent, budget, pct, status };
        }).sort((a, b) => b.spent - a.spent);

        return (
          <section className="rounded-xl overflow-hidden border" style={{ background: "#ffffff", borderColor: "rgba(195,198,213,0.15)" }}>
            <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: "#eff4ff" }}>
              <h3 className="font-bold text-base" style={{ color: "#0b1c30" }}>Orçamento vs. Gasto</h3>
              <div className="flex items-center gap-3">
                {summary.is_copy_forward && (
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full" style={{ background: "#eff4ff", color: "#434653" }}>
                    Herdado do mês anterior
                  </span>
                )}
                <input
                  type="month"
                  value={selectedMonth}
                  onChange={e => setSelectedMonth(e.target.value)}
                  className="rounded-lg px-3 py-1.5 text-xs outline-none"
                  style={{ background: "#eff4ff", color: "#0b1c30", border: "none" }}
                />
              </div>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: "#eff4ff" }}>
                  {["Categoria", "Orçamento", "Gasto", "% Utilizado", "Status"].map(h => (
                    <th key={h} className="px-5 py-3 text-left text-[11px] font-bold uppercase tracking-widest" style={{ color: "#737784" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ cid, cat, spent, budget, pct, status }) => (
                  <tr key={cid} style={{ borderTop: "1px solid #eff4ff" }}
                    onMouseEnter={e => (e.currentTarget.style.background = "#f8f9ff")}
                    onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                    <td className="px-5 py-3 font-medium flex items-center gap-2" style={{ color: "#0b1c30" }}>
                      <span>{cat?.icon ?? "📦"}</span>
                      <span>{cat?.label ?? cid.slice(0, 8)}</span>
                    </td>
                    <td className="px-5 py-3 tabular-nums" style={{ color: "#434653" }}>
                      {budget > 0 ? brl(budget) : <span style={{ color: "#737784" }}>—</span>}
                    </td>
                    <td className="px-5 py-3 font-semibold tabular-nums" style={{ color: "#0b1c30" }}>{brl(spent)}</td>
                    <td className="px-5 py-3">
                      {pct !== null ? (
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-24 rounded-full overflow-hidden" style={{ background: "#eff4ff" }}>
                            <div className="h-full rounded-full" style={{ width: `${Math.min(pct, 100)}%`, background: status === "excedido" ? "#ef4444" : status === "atencao" ? "#f59e0b" : "#006c49" }} />
                          </div>
                          <span className="text-xs tabular-nums" style={{ color: "#434653" }}>{pct.toFixed(0)}%</span>
                        </div>
                      ) : <span style={{ color: "#737784" }}>—</span>}
                    </td>
                    <td className="px-5 py-3">
                      {status === "excedido" && <span className="px-2 py-0.5 rounded-full text-xs font-semibold" style={{ background: "#ffdad6", color: "#ba1a1a" }}>Excedido</span>}
                      {status === "atencao" && <span className="px-2 py-0.5 rounded-full text-xs font-semibold" style={{ background: "#fef3c7", color: "#d97706" }}>Atenção</span>}
                      {status === "ok" && <span className="px-2 py-0.5 rounded-full text-xs font-semibold" style={{ background: "#dcfce7", color: "#166534" }}>No limite</span>}
                      {status === null && <span style={{ color: "#737784" }}>—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })()}

      {/* AI Insights */}
      <section className="rounded-xl p-6" style={{ background: "#ffffff", border: "1px solid rgba(195,198,213,0.15)", borderLeft: "4px solid #063669" }}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-bold text-base" style={{ color: "#0b1c30" }}>Análise de Padrões — IA</h2>
          {llmDate && (
            <span className="rounded-full px-2.5 py-0.5 text-xs font-bold border" style={{ background: "rgba(6,54,105,0.06)", color: "#063669", borderColor: "rgba(6,54,105,0.15)" }}>
              Atualizado {llmDate}
            </span>
          )}
        </div>
        {insights.length > 0 ? (
          <ul className="mb-5 space-y-3">
            {insights.map((insight, i) => (
              <li key={i} className="flex gap-3 text-sm" style={{ color: "#434653" }}>
                <span className="mt-0.5 shrink-0" style={{ color: "#063669" }}>&#9656;</span>
                <span>{insight}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mb-5 text-sm" style={{ color: "#737784" }}>
            Nenhuma análise disponível. Importe extratos e acesse a página de Análise IA para gerar.
          </p>
        )}
        <a href="/dashboard/analysis" className="rounded-lg px-4 py-2 text-sm font-semibold transition-colors inline-block" style={{ border: "1px solid rgba(6,54,105,0.2)", color: "#063669" }}>
          Ver análise completa
        </a>
      </section>
    </div>
  );
}
