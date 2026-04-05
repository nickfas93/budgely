"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

const fmt = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const brl = (n: number) => fmt.format(n);

type BankFilter = "all" | "itau_cartao" | "itau_conta" | "alelo";

function monthBounds(ym: string): { start: string; end: string; monthDate: string } {
  const [y, m] = ym.split("-").map(Number);
  const start = `${ym}-01`;
  const last = new Date(y, m, 0).getDate();
  const end = `${ym}-${String(last).padStart(2, "0")}`;
  return { start, end, monthDate: `${ym}-01` };
}

const SOURCE_LABEL: Record<string, string> = {
  pdf_credit: "PDF cartão",
  pdf_debit: "PDF conta",
  pdf_alelo: "PDF Alelo",
  manual: "Manual",
  whatsapp: "WhatsApp",
};

const BANK_LABEL: Record<string, string> = {
  itau: "Itaú",
  btg: "BTG",
  inter: "Inter",
  alelo: "Alelo",
};

export default function TransactionsPage() {
  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const [month, setMonth] = useState(defaultMonth);
  const [bankFilter, setBankFilter] = useState<BankFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 50;

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  const { start, end, monthDate } = useMemo(() => monthBounds(month), [month]);

  const { data: userId } = useQuery({
    queryKey: ["auth-user-id"],
    queryFn: async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      return user?.id ?? null;
    },
  });

  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      const supabase = createClient();
      const { data } = await supabase.from("categories").select("id, slug, label, color, icon");
      return data ?? [];
    },
  });

  const categoryMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const { data: budgets = [] } = useQuery({
    queryKey: ["budgets", userId, monthDate],
    enabled: !!userId,
    queryFn: async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("budgets")
        .select("category_id, amount")
        .eq("user_id", userId!)
        .eq("month", monthDate);
      return data ?? [];
    },
  });

  const budgetMap = useMemo(
    () => new Map(budgets.map((b) => [b.category_id, b.amount])),
    [budgets]
  );

  // All expenses for the month (unpaginated) — used for chart and % Budget
  const { data: monthExpenses = [] } = useQuery({
    queryKey: ["transactions-month-totals", userId, month],
    enabled: !!userId,
    queryFn: async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("transactions")
        .select("category_id, amount")
        .eq("user_id", userId!)
        .gte("date", start)
        .lte("date", end)
        .lt("amount", 0);
      return data ?? [];
    },
  });

  const categoryTotals = useMemo(() => {
    const map: Record<string, number> = {};
    monthExpenses.forEach((t) => {
      if (t.category_id) {
        map[t.category_id] = (map[t.category_id] ?? 0) + Math.abs(t.amount);
      }
    });
    return map;
  }, [monthExpenses]);

  const chartData = useMemo(
    () =>
      categories
        .map((c) => ({ ...c, spent: categoryTotals[c.id] ?? 0 }))
        .filter((c) => c.spent > 0)
        .sort((a, b) => b.spent - a.spent),
    [categories, categoryTotals]
  );

  const maxSpent = chartData[0]?.spent ?? 1;

  const { data: queryResult, isLoading } = useQuery({
    queryKey: ["transactions", userId, month, bankFilter, categoryFilter, debouncedSearch, page],
    enabled: !!userId,
    queryFn: async () => {
      const supabase = createClient();
      let q = supabase
        .from("transactions")
        .select("id, date, description, amount, source, bank, category_id", { count: "exact" })
        .eq("user_id", userId!)
        .gte("date", start)
        .lte("date", end)
        .order("date", { ascending: false });

      if (bankFilter === "itau_cartao") q = q.eq("source", "pdf_credit");
      else if (bankFilter === "itau_conta") q = q.eq("source", "pdf_debit");
      else if (bankFilter === "alelo") q = q.eq("source", "pdf_alelo");

      if (categoryFilter !== "all") q = q.eq("category_id", categoryFilter);
      if (debouncedSearch) q = q.ilike("description", `%${debouncedSearch}%`);

      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;
      const { data, error, count } = await q.range(from, to);
      if (error) throw error;
      return { rows: data ?? [], count: count ?? 0 };
    },
  });

  const rows = queryResult?.rows ?? [];
  const total = queryResult?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <h1
        className="text-3xl font-extrabold tracking-tight"
        style={{ fontFamily: "var(--font-manrope), Manrope, sans-serif", color: "#0b1c30" }}
      >
        Atividade
      </h1>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-wider" style={{ color: "#434653" }}>Mês</label>
          <input
            type="month"
            value={month}
            onChange={(e) => { setMonth(e.target.value); setPage(1); }}
            className="rounded-lg px-3 py-2 text-sm outline-none"
            style={{ background: "#eff4ff", color: "#0b1c30", border: "none" }}
          />
        </div>
        <div className="flex-1 min-w-48">
          <label className="mb-1 block text-xs font-bold uppercase tracking-wider" style={{ color: "#434653" }}>Buscar</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "#737784" }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
            </span>
            <input
              type="text"
              placeholder="Pesquisar descrição..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="w-full rounded-lg pl-8 pr-3 py-2 text-sm outline-none"
              style={{ background: "#eff4ff", color: "#0b1c30", border: "none" }}
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-wider" style={{ color: "#434653" }}>Categoria</label>
          <select
            value={categoryFilter}
            onChange={(e) => { setCategoryFilter(e.target.value); setPage(1); }}
            className="rounded-lg px-3 py-2 text-sm outline-none"
            style={{ background: "#eff4ff", color: "#0b1c30", border: "none" }}
          >
            <option value="all">Todas</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.icon} {c.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-wider" style={{ color: "#434653" }}>Banco</label>
          <select
            value={bankFilter}
            onChange={(e) => { setBankFilter(e.target.value as BankFilter); setPage(1); }}
            className="rounded-lg px-3 py-2 text-sm outline-none"
            style={{ background: "#eff4ff", color: "#0b1c30", border: "none" }}
          >
            <option value="all">Todos</option>
            <option value="itau_cartao">Itaú Cartão</option>
            <option value="itau_conta">Itaú Conta</option>
            <option value="alelo">Alelo</option>
          </select>
        </div>
      </div>

      {/* Spending chart */}
      {chartData.length > 0 && (
        <div className="rounded-2xl border p-6 space-y-3" style={{ background: "#ffffff", borderColor: "rgba(195,198,213,0.2)" }}>
          <h2 className="text-xs font-bold uppercase tracking-widest" style={{ color: "#434653" }}>
            Gastos por Categoria — {month}
          </h2>
          <div className="space-y-2.5">
            {chartData.map((cat) => {
              const budget = budgetMap.get(cat.id);
              const pctOfBudget = budget ? (cat.spent / budget) * 100 : null;
              const barWidth = (cat.spent / maxSpent) * 100;
              const isOver = pctOfBudget !== null && pctOfBudget > 100;
              return (
                <div key={cat.id} className="flex items-center gap-3">
                  <div className="w-32 flex items-center gap-1.5 shrink-0">
                    <span className="text-base">{cat.icon}</span>
                    <span className="text-xs font-medium truncate" style={{ color: "#434653" }}>{cat.label}</span>
                  </div>
                  <div className="flex-1 h-5 rounded-full overflow-hidden" style={{ background: "#eff4ff" }}>
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${barWidth}%`, background: isOver ? "#ba1a1a" : (cat.color ?? "#063669") }}
                    />
                  </div>
                  <div className="flex items-center gap-2 w-44 justify-end shrink-0">
                    <span className="text-sm font-bold tabular-nums" style={{ color: "#0b1c30" }}>{brl(cat.spent)}</span>
                    {pctOfBudget !== null && (
                      <span
                        className="text-xs rounded-full px-2 py-0.5 font-semibold"
                        style={{
                          background: isOver ? "#fde8e8" : pctOfBudget > 80 ? "#fef9c3" : "#dcfce7",
                          color: isOver ? "#ba1a1a" : pctOfBudget > 80 ? "#92400e" : "#166534",
                        }}
                      >
                        {pctOfBudget.toFixed(0)}%
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Table */}
      <div className="rounded-2xl overflow-hidden border" style={{ background: "#ffffff", borderColor: "rgba(195,198,213,0.2)" }}>
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr style={{ background: "#eff4ff" }}>
              {["Data", "Descrição", "Categoria", "Banco", "Valor", "% Budget"].map((h) => (
                <th key={h} className="px-5 py-4 text-left text-[11px] font-bold uppercase tracking-widest" style={{ color: "#737784" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-sm" style={{ color: "#737784" }}>Carregando...</td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-sm" style={{ color: "#737784" }}>Nenhuma transação neste período.</td>
              </tr>
            ) : (
              rows.map((row, i) => {
                const cat = row.category_id ? (categoryMap.get(row.category_id) ?? null) : null;
                const budget = row.category_id ? budgetMap.get(row.category_id) : undefined;
                const spent = row.category_id ? (categoryTotals[row.category_id] ?? 0) : 0;
                const pctBudget = budget && budget > 0 ? (spent / budget) * 100 : null;
                return (
                  <tr
                    key={row.id}
                    style={{ borderTop: i === 0 ? "none" : "1px solid #eff4ff" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#f8f9ff")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <td className="px-5 py-3 whitespace-nowrap text-xs" style={{ color: "#434653" }}>
                      {row.date ? new Date(row.date + "T12:00:00").toLocaleDateString("pt-BR") : "—"}
                    </td>
                    <td className="px-5 py-3 max-w-xs" style={{ color: "#0b1c30" }}>
                      <span className="line-clamp-2">{row.description}</span>
                    </td>
                    <td className="px-5 py-3">
                      {cat ? (
                        <span
                          className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold"
                          style={{ background: `${cat.color}22`, color: cat.color }}
                        >
                          {cat.icon} {cat.label}
                        </span>
                      ) : (
                        <span style={{ color: "#c3c6d5" }}>—</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-xs" style={{ color: "#737784" }}>
                      {row.bank ? (BANK_LABEL[row.bank] ?? row.bank) : (SOURCE_LABEL[row.source] ?? row.source ?? "—")}
                    </td>
                    <td className="px-5 py-3 font-bold tabular-nums" style={{ color: row.amount < 0 ? "#ba1a1a" : "#006c49" }}>
                      {brl(row.amount)}
                    </td>
                    <td className="px-5 py-3">
                      {pctBudget !== null ? (
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 rounded-full overflow-hidden" style={{ background: "#eff4ff" }}>
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${Math.min(pctBudget, 100)}%`,
                                background: pctBudget > 100 ? "#ba1a1a" : pctBudget > 80 ? "#f59e0b" : "#006c49",
                              }}
                            />
                          </div>
                          <span className="text-xs font-semibold" style={{ color: pctBudget > 100 ? "#ba1a1a" : "#737784" }}>
                            {pctBudget.toFixed(0)}%
                          </span>
                        </div>
                      ) : (
                        <span style={{ color: "#c3c6d5" }}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>

        <div className="flex items-center justify-between px-5 py-3 border-t" style={{ borderColor: "#eff4ff" }}>
          <span className="text-sm" style={{ color: "#434653" }}>{total} lançamento(s)</span>
          {totalPages > 1 && (
            <div className="flex items-center gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded-lg px-3 py-1.5 text-xs font-semibold border disabled:opacity-40 hover:opacity-70 transition-opacity"
                style={{ borderColor: "#c3c6d5", color: "#434653" }}
              >
                Anterior
              </button>
              <span className="text-xs" style={{ color: "#737784" }}>{page} / {totalPages}</span>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="rounded-lg px-3 py-1.5 text-xs font-semibold border disabled:opacity-40 hover:opacity-70 transition-opacity"
                style={{ borderColor: "#c3c6d5", color: "#434653" }}
              >
                Próxima
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
