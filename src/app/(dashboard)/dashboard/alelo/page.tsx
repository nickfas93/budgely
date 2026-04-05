"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { toast } from "sonner";

const brl = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);

const WALLET_LABELS: Record<string, string> = { refeicao: "Refeição", alimentacao: "Alimentação" };
const WALLET_COLORS: Record<string, string> = { refeicao: "#f59e0b", alimentacao: "#006c49" };

type FilterType = "todos" | "refeicao" | "alimentacao";

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

type EditState = { txId: string; categoryId: string; applyToMerchant: boolean } | null;

export default function AleloPage() {
  const [month, setMonth] = useState(() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`;
  });
  const [filter, setFilter] = useState<FilterType>("todos");
  const [editing, setEditing] = useState<EditState>(null);
  const qc = useQueryClient();
  const supabase = createClient();

  const { start, end } = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    const last = new Date(y, m, 0).getDate();
    return {
      start: `${month}-01`,
      end: `${month}-${String(last).padStart(2, "0")}`,
    };
  }, [month]);

  const { data: userId } = useQuery({
    queryKey: ["auth-user-id"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      return user?.id ?? null;
    },
  });

  const { data: budget } = useQuery({
    queryKey: ["alelo-budget", userId, `${month}-01`],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase
        .from("alelo_budgets")
        .select("refeicao_budget, alimentacao_budget")
        .eq("user_id", userId!)
        .eq("month", `${month}-01`)
        .maybeSingle();
      return data;
    },
  });

  const { data: transactions = [], isLoading } = useQuery({
    queryKey: ["alelo-transactions", userId, start, end],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase
        .from("transactions")
        .select("id, date, description, merchant, amount, alelo_wallet_type, category_id")
        .eq("user_id", userId!)
        .eq("bank", "alelo")
        .gte("date", start)
        .lte("date", end)
        .order("date", { ascending: false });
      return data ?? [];
    },
  });

  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      const { data } = await supabase.from("categories").select("id, slug, label, icon");
      return data ?? [];
    },
  });

  const patchMutation = useMutation({
    mutationFn: async ({ txId, categoryId, applyToMerchant }: { txId: string; categoryId: string; applyToMerchant: boolean }) => {
      const res = await fetch(`/api/transactions/${txId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category_id: categoryId, apply_to_merchant: applyToMerchant }),
      });
      const json = await res.json() as { error?: string; updated_count?: number };
      if (!res.ok) throw new Error(json.error ?? "Falha ao atualizar categoria");
      return json;
    },
    onSuccess: (data) => {
      toast.success(`Categoria atualizada${(data.updated_count ?? 0) > 1 ? ` em ${data.updated_count} transações` : ""}.`);
      setEditing(null);
      void qc.invalidateQueries({ queryKey: ["alelo-transactions"] });
      void qc.invalidateQueries({ queryKey: ["dashboard-summary"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const wallets = useMemo(() => {
    const spentRef = transactions.filter((t) => t.alelo_wallet_type === "refeicao").reduce((s, t) => s + Number(t.amount), 0);
    const spentAlim = transactions.filter((t) => t.alelo_wallet_type === "alimentacao").reduce((s, t) => s + Number(t.amount), 0);
    return [
      { type: "refeicao", label: "Refeição", budget: budget?.refeicao_budget ?? 0, spent: spentRef, color: "#f59e0b" },
      { type: "alimentacao", label: "Alimentação", budget: budget?.alimentacao_budget ?? 0, spent: spentAlim, color: "#006c49" },
    ];
  }, [transactions, budget]);

  const chartData = wallets.map((w) => ({
    name: w.label,
    gasto: w.spent,
    restante: Math.max(0, w.budget - w.spent),
  }));

  const filtered = filter === "todos" ? transactions : transactions.filter((t) => t.alelo_wallet_type === filter);

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <div className="flex justify-between items-end">
        <div>
          <span className="text-xs font-bold uppercase tracking-[0.2em] mb-2 block" style={{ color: "#063669" }}>Detalhamento Mensal</span>
          <h1 className="text-4xl font-extrabold tracking-tight" style={{ fontFamily: "var(--font-manrope), Manrope, sans-serif", color: "#0b1c30" }}>
            Gestão Alelo
          </h1>
        </div>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)}
          className="rounded-xl px-4 py-2 text-sm outline-none"
          style={{ background: "#eff4ff", color: "#0b1c30", border: "none" }} />
      </div>

      {/* Chart + balance card */}
      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-12 lg:col-span-8 rounded-xl p-8" style={{ background: "#ffffff", border: "1px solid rgba(195,198,213,0.15)" }}>
          <div className="flex justify-between items-start mb-8">
            <div>
              <h4 className="text-lg font-bold" style={{ fontFamily: "var(--font-manrope), Manrope, sans-serif", color: "#0b1c30" }}>Fluxo de Caixa: Alelo</h4>
              <p className="text-sm" style={{ color: "#434653" }}>Análise de uso por carteira</p>
            </div>
            <div className="text-right">
              <span className="text-3xl font-black tracking-tighter block" style={{ fontFamily: "var(--font-manrope), Manrope, sans-serif", color: "#063669" }}>
                {brl(wallets.reduce((s, w) => s + w.spent, 0))}
              </span>
              <p className="text-xs font-bold mt-1" style={{ color: "#434653" }}>Total gasto no período</p>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
              <XAxis dataKey="name" tick={{ fill: "#737784", fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={(v) => `R$${(v / 1000).toFixed(1)}k`} tick={{ fill: "#737784", fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: "#eff4ff" }} />
              <Bar dataKey="gasto" stackId="a" radius={[0, 0, 0, 0]}>
                {chartData.map((_, i) => <Cell key={i} fill={wallets[i].color} />)}
              </Bar>
              <Bar dataKey="restante" stackId="a" radius={[4, 4, 0, 0]}>
                {chartData.map((_, i) => <Cell key={i} fill={`${wallets[i].color}33`} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="col-span-12 lg:col-span-4 rounded-xl p-6 relative overflow-hidden" style={{ background: "#274e82" }}>
          <div className="absolute inset-0 pointer-events-none" style={{ background: "rgba(255,255,255,0.04)" }} />
          <div className="relative z-10">
            <div className="mb-6 flex justify-between items-start">
              <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#9cc0fb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>
              <span className="px-2 py-1 rounded text-[10px] font-bold uppercase tracking-widest" style={{ background: "rgba(255,255,255,0.15)", color: "#ffffff" }}>Alelo</span>
            </div>
            {wallets.map((w) => {
              const pct = w.budget > 0 ? Math.min((w.spent / w.budget) * 100, 100) : 0;
              const isOver = w.budget > 0 && w.spent > w.budget;
              return (
                <div key={w.type} className="mb-5">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm font-bold" style={{ color: "#ffffff" }}>{w.label}</span>
                    <span className="text-xs" style={{ color: isOver ? "#fca5a5" : "#9cc0fb" }}>
                      {pct.toFixed(0)}%
                    </span>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.15)" }}>
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: isOver ? "#ef4444" : w.color }} />
                  </div>
                  <div className="flex justify-between mt-1 text-xs" style={{ color: "rgba(255,255,255,0.6)" }}>
                    <span>{brl(w.spent)}</span>
                    <span>de {brl(w.budget)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Wallet cards */}
      <div className="grid gap-4 sm:grid-cols-2">
        {wallets.map((w) => {
          const pct = w.budget > 0 ? Math.min((w.spent / w.budget) * 100, 100) : 0;
          const remaining = w.budget - w.spent;
          const isOver = w.budget > 0 && w.spent > w.budget;
          const isWarn = pct >= 90;
          return (
            <div key={w.type} className="rounded-xl p-5 border" style={{ background: "#ffffff", borderColor: "rgba(195,198,213,0.15)" }}>
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: w.color }} />
                  <span className="font-medium" style={{ color: "#0b1c30" }}>{w.label}</span>
                </div>
                <span className="text-xs font-medium" style={{ color: isOver ? "#ba1a1a" : isWarn ? "#d97706" : "#737784" }}>
                  {pct.toFixed(0)}% usado
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full mb-4" style={{ background: "#eff4ff" }}>
                <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: isOver ? "#ef4444" : isWarn ? "#f59e0b" : w.color }} />
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                {[["Orçamento", w.budget], ["Gasto", w.spent], ["Restante", remaining]].map(([label, val]) => (
                  <div key={label as string}>
                    <p className="text-xs" style={{ color: "#737784" }}>{label}</p>
                    <p className="text-sm font-semibold" style={{ color: label === "Restante" && isOver ? "#ba1a1a" : "#0b1c30" }}>
                      {brl(Number(val))}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 p-1 rounded-full w-fit" style={{ background: "#eff4ff" }}>
        {(["todos", "refeicao", "alimentacao"] as FilterType[]).map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)}
            className="rounded-full px-4 py-1.5 text-sm font-semibold transition-all"
            style={filter === f ? { background: "#ffffff", color: "#063669", boxShadow: "0 1px 4px rgba(6,54,105,0.1)" } : { color: "#737784" }}>
            {f === "todos" ? "Todos" : WALLET_LABELS[f]}
          </button>
        ))}
      </div>

      {/* Transactions table */}
      <div className="rounded-xl overflow-hidden border" style={{ background: "#ffffff", borderColor: "rgba(195,198,213,0.15)" }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: "#eff4ff" }}>
              {["Data", "Estabelecimento", "Carteira", "Categoria", "Valor", ""].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-widest" style={{ color: "#737784" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-sm" style={{ color: "#737784" }}>Carregando...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-sm" style={{ color: "#737784" }}>Nenhuma transação no período.</td></tr>
            ) : (
              filtered.map((t) => {
                const wallet = t.alelo_wallet_type ?? "";
                const isEditingThis = editing?.txId === t.id;
                return (
                  <tr key={t.id} className="transition-colors" style={{ borderTop: "1px solid #eff4ff" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#f8f9ff")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                    <td className="px-4 py-3 whitespace-nowrap" style={{ color: "#434653" }}>
                      {new Date(t.date + "T12:00:00").toLocaleDateString("pt-BR")}
                    </td>
                    <td className="px-4 py-3 font-medium" style={{ color: "#0b1c30" }}>{t.merchant ?? "—"}</td>
                    <td className="px-4 py-3">
                      {wallet ? (
                        <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium" style={{ backgroundColor: `${WALLET_COLORS[wallet]}22`, color: WALLET_COLORS[wallet] }}>
                          {WALLET_LABELS[wallet] ?? wallet}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {isEditingThis ? (
                        <div className="space-y-1.5">
                          <select
                            value={editing.categoryId}
                            onChange={e => setEditing(prev => prev ? { ...prev, categoryId: e.target.value } : null)}
                            className="w-full rounded-lg px-2 py-1.5 text-xs outline-none" style={{ background: "#eff4ff", color: "#0b1c30", border: "none" }}>
                            <option value="">— Sem categoria —</option>
                            {categories.map(c => <option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
                          </select>
                          <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: "#434653" }}>
                            <input type="checkbox" checked={editing.applyToMerchant}
                              onChange={e => setEditing(prev => prev ? { ...prev, applyToMerchant: e.target.checked } : null)} />
                            Aplicar a todos: <strong>{t.merchant ?? t.description}</strong>
                          </label>
                        </div>
                      ) : (
                        <span style={{ color: "#737784", fontSize: 12 }}>
                          {categories.find(c => c.id === t.category_id)?.label ?? "—"}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-bold tabular-nums" style={{ color: "#0b1c30" }}>{brl(Number(t.amount))}</td>
                    <td className="px-4 py-3">
                      {isEditingThis ? (
                        <div className="flex gap-2">
                          <button onClick={() => patchMutation.mutate({ txId: editing.txId, categoryId: editing.categoryId, applyToMerchant: editing.applyToMerchant })}
                            disabled={!editing.categoryId || patchMutation.isPending}
                            className="text-xs font-bold hover:opacity-70 disabled:opacity-40" style={{ color: "#006c49" }}>
                            {patchMutation.isPending ? "..." : "Salvar"}
                          </button>
                          <button onClick={() => setEditing(null)} className="text-xs font-semibold hover:opacity-70" style={{ color: "#737784" }}>
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => setEditing({ txId: t.id, categoryId: t.category_id ?? "", applyToMerchant: false })}
                          className="text-xs font-semibold hover:opacity-70" style={{ color: "#063669" }}>
                          Editar
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
