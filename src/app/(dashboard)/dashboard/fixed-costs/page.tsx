"use client";

import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";

const brl = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);

const BANK_LABELS: Record<string, string> = {
  itau_conta: "Itaú Conta",
  itau_cartao: "Itaú Cartão",
  btg: "BTG",
  alelo: "Alelo",
};
const CATEGORY_LABELS: Record<string, string> = {
  moradia: "Moradia",
  servicos: "Serviços",
  transporte: "Transporte",
  educacao: "Educação",
  saude: "Saúde",
  lazer: "Lazer",
  alimentacao: "Alimentação",
  outros: "Outros",
};
const BANKS = Object.entries(BANK_LABELS);
const CATEGORIES = Object.entries(CATEGORY_LABELS);

// ALLOCATIONS removido — substituído por budgets dinâmicos da tabela `budgets`

const emptyForm = { name: "", amount: "", due_day: "", bank: "itau_conta", category: "moradia" };

type DbCost = { id: string; name: string; amount: number; category_id: string | null };

export default function FixedCostsPage() {
  const [activeTab, setActiveTab] = useState<"architect" | "table">("table");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  // Budget Architect state
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`;
  });
  // categoryId → amount (R$) — estado local dos sliders
  const [budgetDraft, setBudgetDraft] = useState<Record<string, number>>({});
  const [isCopyForward, setIsCopyForward] = useState(false);
  const [copyFromMonth, setCopyFromMonth] = useState<string | null>(null);
  const qc = useQueryClient();
  const supabase = createClient();

  const { data: userId } = useQuery({
    queryKey: ["auth-user-id"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      return user?.id ?? null;
    },
  });

  const { data: profile } = useQuery({
    queryKey: ["profile", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase.from("budgely_users").select("monthly_salary").eq("id", userId!).maybeSingle();
      return data;
    },
  });

  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      const { data } = await supabase.from("categories").select("id, slug, label, color, icon");
      return data ?? [];
    },
  });

  const monthDate = `${selectedMonth}-01`;

  // Budgets do mês selecionado
  const { data: budgetsForMonth = [] } = useQuery({
    queryKey: ["budgets", userId, monthDate],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase
        .from("budgets")
        .select("*")
        .eq("user_id", userId!)
        .eq("month", monthDate);
      return data ?? [];
    },
  });

  // Copy-forward: buscar mês mais recente se vazio
  const { data: previousBudgets = [] } = useQuery({
    queryKey: ["budgets-prev", userId, monthDate],
    enabled: !!userId && budgetsForMonth.length === 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("budgets")
        .select("*")
        .eq("user_id", userId!)
        .lt("month", monthDate)
        .order("month", { ascending: false });
      if (!data || data.length === 0) return [];
      // DISTINCT ON category_id
      const seen = new Set<string>();
      return data.filter(b => {
        if (seen.has(b.category_id)) return false;
        seen.add(b.category_id);
        return true;
      });
    },
  });

  // Preencher draft quando os dados chegam
  useEffect(() => {
    const source = budgetsForMonth.length > 0 ? budgetsForMonth : previousBudgets;
    const isForward = budgetsForMonth.length === 0 && previousBudgets.length > 0;
    const draft: Record<string, number> = {};
    source.forEach(b => { draft[b.category_id] = b.amount; });
    setBudgetDraft(draft);
    setIsCopyForward(isForward);
    if (isForward && previousBudgets[0]) {
      setCopyFromMonth(previousBudgets[0].month.slice(0, 7));
    } else {
      setCopyFromMonth(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [budgetsForMonth.length, previousBudgets.length, selectedMonth]);

  const saveBudgetsMutation = useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error("Não autenticado");
      // Categorias com valor > 0
      const toUpsert = Object.entries(budgetDraft)
        .filter(([, amount]) => amount > 0)
        .map(([category_id, amount]) => ({ user_id: userId, category_id, month: monthDate, amount }));
      const toDeleteCatIds = Object.entries(budgetDraft)
        .filter(([, amount]) => amount === 0)
        .map(([category_id]) => category_id);

      if (toUpsert.length > 0) {
        const { error } = await supabase
          .from("budgets")
          .upsert(toUpsert, { onConflict: "user_id,category_id,month" });
        if (error) throw new Error(error.message);
      }
      if (toDeleteCatIds.length > 0) {
        await supabase
          .from("budgets")
          .delete()
          .eq("user_id", userId)
          .eq("month", monthDate)
          .in("category_id", toDeleteCatIds);
      }
    },
    onSuccess: () => {
      toast.success("Plano de orçamento salvo!");
      void qc.invalidateQueries({ queryKey: ["budgets"] });
      void qc.invalidateQueries({ queryKey: ["dashboard-summary"] });
      setIsCopyForward(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const { data: costs = [], isLoading } = useQuery({
    queryKey: ["fixed-costs", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase
        .from("fixed_costs")
        .select("id, name, amount, category_id")
        .eq("user_id", userId!)
        .eq("active", true)
        .order("amount", { ascending: false });
      return (data ?? []) as DbCost[];
    },
  });

  const slugToId = new Map(categories.map((c) => [c.slug, c.id]));
  const idToSlug = new Map(categories.map((c) => [c.id, c.slug]));

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!userId || !form.name || !form.amount) return;
      const payload = {
        name: form.name,
        amount: parseFloat(form.amount),
        category_id: slugToId.get(form.category) ?? null,
        user_id: userId,
        active: true,
      };
      if (editingId) {
        await supabase.from("fixed_costs").update(payload).eq("id", editingId);
      } else {
        await supabase.from("fixed_costs").insert(payload);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fixed-costs"] });
      closeModal();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from("fixed_costs").update({ active: false }).eq("id", id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fixed-costs"] }),
  });

  const openAdd = () => { setEditingId(null); setForm(emptyForm); setModalOpen(true); };
  const openEdit = (cost: DbCost) => {
    setEditingId(cost.id);
    setForm({
      name: cost.name,
      amount: String(cost.amount),
      due_day: "",
      bank: "itau_conta",
      category: idToSlug.get(cost.category_id ?? "") ?? "outros",
    });
    setModalOpen(true);
  };
  const closeModal = () => { setModalOpen(false); setEditingId(null); setForm(emptyForm); };

  const total = costs.reduce((s, c) => s + Number(c.amount), 0);
  const monthlyIncome = profile?.monthly_salary ?? 0;
  const totalAllocated = useMemo(
    () => Object.values(budgetDraft).reduce((s, v) => s + v, 0),
    [budgetDraft]
  );
  const salaryRemaining = monthlyIncome - totalAllocated;

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h1 className="text-5xl font-extrabold tracking-tighter mb-2" style={{ fontFamily: "var(--font-manrope), Manrope, sans-serif", color: "#0b1c30" }}>
            Budget Architect
          </h1>
          <p className="text-lg max-w-2xl" style={{ color: "#434653" }}>
            Gerencie seus custos fixos e alocações mensais.
          </p>
        </div>
      </header>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-full w-fit" style={{ background: "#eff4ff" }}>
        {[{ key: "table", label: "Custos Fixos" }, { key: "architect", label: "Arquitetura" }].map((tab) => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key as "architect" | "table")}
            className="px-6 py-2 rounded-full text-sm font-semibold transition-all"
            style={activeTab === tab.key ? { background: "#ffffff", color: "#063669", boxShadow: "0 1px 4px rgba(6,54,105,0.1)" } : { color: "#737784" }}>
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "table" ? (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium" style={{ color: "#434653" }}>
              Total mensal: <span className="font-bold" style={{ color: "#0b1c30" }}>{brl(total)}</span>
            </p>
            <button onClick={openAdd} className="rounded-xl px-5 py-2.5 text-sm font-bold transition-opacity hover:opacity-90" style={{ background: "#063669", color: "#ffffff" }}>
              + Novo Custo Fixo
            </button>
          </div>

          <div className="rounded-xl overflow-hidden border" style={{ background: "#ffffff", borderColor: "rgba(195,198,213,0.2)" }}>
            {isLoading ? (
              <div className="p-12 text-center text-sm" style={{ color: "#737784" }}>Carregando...</div>
            ) : costs.length === 0 ? (
              <div className="p-12 text-center text-sm" style={{ color: "#737784" }}>Nenhum custo fixo cadastrado.</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: "#eff4ff" }}>
                    {["Descrição", "Valor", "Vencimento", "Banco", "Categoria", "Ações"].map((h) => (
                      <th key={h} className="px-6 py-4 text-left text-[11px] font-bold uppercase tracking-widest" style={{ color: "#737784" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {costs.map((cost, i) => {
                    const slug = idToSlug.get(cost.category_id ?? "") ?? "";
                    return (
                      <tr key={cost.id} className="transition-colors" style={{ borderTop: i === 0 ? "none" : "1px solid #eff4ff" }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "#f8f9ff")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                        <td className="px-6 py-4 font-medium" style={{ color: "#0b1c30" }}>{cost.name}</td>
                        <td className="px-6 py-4 font-bold" style={{ color: "#0b1c30" }}>{brl(Number(cost.amount))}</td>
                        <td className="px-6 py-4" style={{ color: "#434653" }}>—</td>
                        <td className="px-6 py-4" style={{ color: "#434653" }}>—</td>
                        <td className="px-6 py-4">
                          <span className="px-3 py-1 rounded-full text-xs font-semibold" style={{ background: "#eff4ff", color: "#434653" }}>
                            {(CATEGORY_LABELS[slug] ?? slug) || "—"}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex gap-3">
                            <button onClick={() => openEdit(cost)} className="text-xs font-semibold hover:opacity-70" style={{ color: "#063669" }}>Editar</button>
                            <button onClick={() => { if (window.confirm(`Excluir "${cost.name}"?`)) deleteMutation.mutate(cost.id); }} className="text-xs font-semibold hover:opacity-70" style={{ color: "#ba1a1a" }}>Excluir</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            <div className="flex justify-end px-6 py-4 border-t" style={{ borderColor: "#eff4ff" }}>
              <span className="text-sm" style={{ color: "#434653" }}>Total mensal: <span className="font-bold" style={{ color: "#0b1c30" }}>{brl(total)}</span></span>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Month selector + copy-forward badge */}
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <label className="text-xs font-bold uppercase tracking-wider" style={{ color: "#434653" }}>Mês</label>
              <input
                type="month"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="rounded-lg px-3 py-1.5 text-sm outline-none"
                style={{ background: "#eff4ff", color: "#0b1c30", border: "none" }}
              />
            </div>
            {isCopyForward && copyFromMonth && (
              <span className="rounded-full px-3 py-1 text-xs font-semibold" style={{ background: "#dbeafe", color: "#1d4ed8" }}>
                Copiado de {copyFromMonth}
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* Category sliders */}
            <div className="lg:col-span-8 space-y-4">
              {monthlyIncome > 0 && (
                <section className="rounded-2xl px-6 py-4 flex items-center justify-between" style={{ background: "#eff4ff" }}>
                  <span className="text-sm font-bold" style={{ color: "#434653" }}>Renda Mensal Líquida</span>
                  <span className="text-2xl font-black" style={{ fontFamily: "var(--font-manrope), Manrope, sans-serif", color: "#0b1c30" }}>
                    {brl(monthlyIncome)}
                  </span>
                </section>
              )}

              <div className="rounded-2xl border overflow-hidden" style={{ background: "#ffffff", borderColor: "rgba(195,198,213,0.2)" }}>
                {categories.length === 0 ? (
                  <div className="p-8 text-center text-sm" style={{ color: "#737784" }}>Carregando categorias...</div>
                ) : (
                  <div>
                    {categories.map((cat, i) => {
                      const val = budgetDraft[cat.id] ?? 0;
                      const pct = monthlyIncome > 0 ? (val / monthlyIncome) * 100 : 0;
                      return (
                        <div key={cat.id} className="px-6 py-4" style={{ borderTop: i === 0 ? "none" : "1px solid #eff4ff" }}>
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-3">
                              <span className="text-xl">{cat.icon}</span>
                              <span className="text-sm font-semibold" style={{ color: "#0b1c30" }}>{cat.label}</span>
                              {monthlyIncome > 0 && val > 0 && (
                                <span className="text-xs" style={{ color: "#737784" }}>{pct.toFixed(1)}% da renda</span>
                              )}
                            </div>
                            <div className="flex items-center gap-1">
                              <span className="text-xs" style={{ color: "#737784" }}>R$</span>
                              <input
                                type="number"
                                min="0"
                                step="10"
                                value={val || ""}
                                placeholder="0"
                                onChange={(e) => setBudgetDraft((d) => ({ ...d, [cat.id]: parseFloat(e.target.value) || 0 }))}
                                className="w-28 rounded-lg px-3 py-1.5 text-sm font-bold text-right outline-none"
                                style={{ background: "#eff4ff", color: "#0b1c30", border: "none" }}
                              />
                            </div>
                          </div>
                          <input
                            type="range"
                            min="0"
                            max={monthlyIncome > 0 ? monthlyIncome : 10000}
                            step="10"
                            value={val}
                            onChange={(e) => setBudgetDraft((d) => ({ ...d, [cat.id]: parseFloat(e.target.value) }))}
                            className="w-full h-2 rounded-full appearance-none outline-none cursor-pointer"
                            style={{ accentColor: cat.color ?? "#063669" }}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Summary sidebar */}
            <div className="lg:col-span-4">
              <div className="sticky top-24">
                <div className="relative overflow-hidden rounded-3xl p-8 text-white shadow-2xl" style={{ background: "#063669" }}>
                  <div className="absolute -bottom-10 -right-10 w-48 h-48 rounded-full blur-3xl pointer-events-none" style={{ background: "rgba(108,248,187,0.15)" }} />
                  <div className="relative z-10 space-y-5">
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-widest opacity-70 mb-1">Renda Mensal</h4>
                      <p className="text-3xl font-black tracking-tighter" style={{ fontFamily: "var(--font-manrope), Manrope, sans-serif" }}>
                        {brl(monthlyIncome)}
                      </p>
                    </div>
                    <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.15)" }}>
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${monthlyIncome > 0 ? Math.min((totalAllocated / monthlyIncome) * 100, 100) : 0}%`,
                          background: salaryRemaining < 0 ? "#ff6b6b" : "#6cf8bb",
                        }}
                      />
                    </div>
                    <div className="flex justify-between">
                      <div>
                        <p className="text-xs opacity-60 uppercase font-bold">Alocado</p>
                        <p className="text-xl font-bold">{brl(totalAllocated)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs opacity-60 uppercase font-bold">Disponível</p>
                        <p className="text-xl font-bold" style={{ color: salaryRemaining < 0 ? "#ff6b6b" : "#6cf8bb" }}>
                          {brl(salaryRemaining)}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => saveBudgetsMutation.mutate()}
                      disabled={saveBudgetsMutation.isPending}
                      className="w-full rounded-xl py-3 text-sm font-bold transition-opacity hover:opacity-90 disabled:opacity-50"
                      style={{ background: "#6cf8bb", color: "#063669" }}
                    >
                      {saveBudgetsMutation.isPending ? "Salvando..." : "Salvar Plano"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(11,28,48,0.5)" }}>
          <div className="w-full max-w-md rounded-2xl p-6 shadow-2xl" style={{ background: "#ffffff" }}>
            <h2 className="mb-5 text-lg font-bold" style={{ fontFamily: "var(--font-manrope), Manrope, sans-serif", color: "#0b1c30" }}>
              {editingId ? "Editar Custo Fixo" : "Novo Custo Fixo"}
            </h2>
            <div className="space-y-4">
              {[
                { label: "Descrição", key: "name", type: "text", placeholder: "Ex: Netflix" },
                { label: "Valor (R$)", key: "amount", type: "number", placeholder: "0,00" },
                { label: "Dia Vencimento", key: "due_day", type: "number", placeholder: "1-31" },
              ].map(({ label, key, type, placeholder }) => (
                <div key={key}>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wider" style={{ color: "#434653" }}>{label}</label>
                  <input
                    type={type}
                    value={form[key as keyof typeof form]}
                    onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                    className="w-full rounded-lg px-4 py-3 text-sm outline-none"
                    style={{ background: "#eff4ff", color: "#0b1c30", border: "none" }}
                    placeholder={placeholder}
                  />
                </div>
              ))}
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wider" style={{ color: "#434653" }}>Banco</label>
                <select value={form.bank} onChange={(e) => setForm({ ...form, bank: e.target.value })} className="w-full rounded-lg px-4 py-3 text-sm outline-none" style={{ background: "#eff4ff", color: "#0b1c30", border: "none" }}>
                  {BANKS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wider" style={{ color: "#434653" }}>Categoria</label>
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="w-full rounded-lg px-4 py-3 text-sm outline-none" style={{ background: "#eff4ff", color: "#0b1c30", border: "none" }}>
                  {CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button onClick={closeModal} className="rounded-xl px-5 py-2.5 text-sm font-semibold border hover:opacity-80" style={{ color: "#434653", borderColor: "#c3c6d5" }}>Cancelar</button>
              <button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} className="rounded-xl px-5 py-2.5 text-sm font-bold hover:opacity-90 disabled:opacity-50" style={{ background: "#063669", color: "#ffffff" }}>
                {saveMutation.isPending ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
