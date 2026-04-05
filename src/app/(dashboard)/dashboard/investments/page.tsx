"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { InvestmentAsset } from "@/types/database";

const brl = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);

const pct = (n: number) =>
  `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

const ASSET_TYPE_LABELS: Record<string, string> = {
  acao: "Ação",
  fii: "FII",
  etf: "ETF",
  bdr: "BDR",
  crypto: "Crypto",
};

type QuoteData = { price: number; changePercent: number };

type AddForm = {
  ticker: string;
  name: string;
  quantity: string;
  avg_price: string;
  asset_type: InvestmentAsset["asset_type"];
};

const EMPTY_FORM: AddForm = {
  ticker: "",
  name: "",
  quantity: "",
  avg_price: "",
  asset_type: "acao",
};

export default function InvestmentsPage() {
  const supabase = createClient();
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<AddForm>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);

  // Auth
  const { data: userId } = useQuery({
    queryKey: ["auth-user-id"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      return user?.id ?? null;
    },
  });

  // Assets
  const { data: assets = [], isLoading } = useQuery<InvestmentAsset[]>({
    queryKey: ["investment-assets", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("investment_assets")
        .select("*")
        .eq("user_id", userId!)
        .eq("active", true)
        .order("ticker");
      if (error) throw error;
      return data ?? [];
    },
  });

  // Quotes
  const tickers = assets.map(a => a.ticker).join(",");
  const { data: quotesData } = useQuery<{ quotes: Record<string, QuoteData>; ibov: number | null }>({
    queryKey: ["investment-quotes", tickers],
    enabled: assets.length > 0,
    refetchInterval: 15 * 60 * 1000,
    queryFn: async () => {
      const res = await fetch(`/api/investments/quotes?tickers=${encodeURIComponent(tickers)}`);
      if (!res.ok) throw new Error("Falha ao buscar cotações");
      return res.json();
    },
  });

  const quotes = quotesData?.quotes ?? {};
  const ibov = quotesData?.ibov ?? null;

  // Portfolio metrics
  const portfolio = useMemo(() => {
    let totalCost = 0;
    let totalCurrent = 0;
    const rows = assets.map(a => {
      const q = quotes[a.ticker];
      const currentPrice = q?.price ?? a.avg_price;
      const cost = Number(a.avg_price) * Number(a.quantity);
      const current = currentPrice * Number(a.quantity);
      const pl = current - cost;
      const plPct = cost > 0 ? (pl / cost) * 100 : 0;
      totalCost += cost;
      totalCurrent += current;
      return { ...a, currentPrice, cost, current, pl, plPct, changePercent: q?.changePercent ?? null };
    });
    const totalPl = totalCurrent - totalCost;
    const totalPlPct = totalCost > 0 ? (totalPl / totalCost) * 100 : 0;
    return { rows, totalCost, totalCurrent, totalPl, totalPlPct };
  }, [assets, quotes]);

  // Add asset mutation
  const addMutation = useMutation({
    mutationFn: async (f: AddForm) => {
      const { error } = await supabase.from("investment_assets").insert({
        user_id: userId!,
        ticker: f.ticker.trim().toUpperCase(),
        name: f.name.trim() || null,
        quantity: parseFloat(f.quantity),
        avg_price: parseFloat(f.avg_price),
        asset_type: f.asset_type,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["investment-assets"] });
      setShowAdd(false);
      setForm(EMPTY_FORM);
      setFormError(null);
    },
    onError: (e: Error) => setFormError(e.message),
  });

  // Remove asset mutation
  const removeMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("investment_assets")
        .update({ active: false })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["investment-assets"] }),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const qty = parseFloat(form.quantity);
    const price = parseFloat(form.avg_price);
    if (!form.ticker.trim()) return setFormError("Ticker obrigatório");
    if (isNaN(qty) || qty <= 0) return setFormError("Quantidade inválida");
    if (isNaN(price) || price <= 0) return setFormError("Preço médio inválido");
    addMutation.mutate(form);
  }

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight" style={{ fontFamily: "var(--font-manrope), Manrope, sans-serif", color: "#0b1c30" }}>
            Investimentos
          </h1>
          <p className="text-sm mt-1" style={{ color: "#737784" }}>Cotações B3 em tempo real · Atualizado a cada 15 min</p>
        </div>
        <button
          onClick={() => setShowAdd(v => !v)}
          className="px-5 py-2.5 rounded-xl text-sm font-bold transition-opacity hover:opacity-90"
          style={{ background: "#063669", color: "#ffffff" }}
        >
          + Adicionar ativo
        </button>
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="rounded-2xl p-6 border" style={{ background: "#ffffff", borderColor: "rgba(195,198,213,0.2)" }}>
          <h2 className="font-bold text-base mb-4" style={{ color: "#0b1c30" }}>Novo ativo</h2>
          <form onSubmit={handleSubmit} className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <div>
              <label className="block text-xs font-bold mb-1" style={{ color: "#737784" }}>Ticker *</label>
              <input
                className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                style={{ background: "#eff4ff", color: "#0b1c30", border: "1px solid transparent" }}
                value={form.ticker}
                onChange={e => setForm(f => ({ ...f, ticker: e.target.value }))}
                placeholder="PETR4"
              />
            </div>
            <div>
              <label className="block text-xs font-bold mb-1" style={{ color: "#737784" }}>Nome</label>
              <input
                className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                style={{ background: "#eff4ff", color: "#0b1c30", border: "1px solid transparent" }}
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Petrobras"
              />
            </div>
            <div>
              <label className="block text-xs font-bold mb-1" style={{ color: "#737784" }}>Quantidade *</label>
              <input
                type="number"
                min="0"
                step="any"
                className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                style={{ background: "#eff4ff", color: "#0b1c30", border: "1px solid transparent" }}
                value={form.quantity}
                onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))}
                placeholder="100"
              />
            </div>
            <div>
              <label className="block text-xs font-bold mb-1" style={{ color: "#737784" }}>Preço médio (R$) *</label>
              <input
                type="number"
                min="0"
                step="any"
                className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                style={{ background: "#eff4ff", color: "#0b1c30", border: "1px solid transparent" }}
                value={form.avg_price}
                onChange={e => setForm(f => ({ ...f, avg_price: e.target.value }))}
                placeholder="38.50"
              />
            </div>
            <div>
              <label className="block text-xs font-bold mb-1" style={{ color: "#737784" }}>Tipo</label>
              <select
                className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                style={{ background: "#eff4ff", color: "#0b1c30", border: "1px solid transparent" }}
                value={form.asset_type}
                onChange={e => setForm(f => ({ ...f, asset_type: e.target.value as InvestmentAsset["asset_type"] }))}
              >
                {Object.entries(ASSET_TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div className="col-span-2 lg:col-span-5 flex items-center gap-3">
              {formError && <p className="text-xs font-medium" style={{ color: "#ba1a1a" }}>{formError}</p>}
              <button
                type="submit"
                disabled={addMutation.isPending}
                className="ml-auto px-6 py-2 rounded-lg text-sm font-bold transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ background: "#006c49", color: "#ffffff" }}
              >
                {addMutation.isPending ? "Salvando..." : "Salvar"}
              </button>
              <button
                type="button"
                onClick={() => { setShowAdd(false); setForm(EMPTY_FORM); setFormError(null); }}
                className="px-4 py-2 rounded-lg text-sm font-medium"
                style={{ color: "#737784" }}
              >
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Summary cards */}
      {assets.length > 0 && (
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            {
              label: "Valor da Carteira",
              value: brl(portfolio.totalCurrent),
              sub: `Custo: ${brl(portfolio.totalCost)}`,
              dot: "#063669",
            },
            {
              label: "Lucro / Prejuízo",
              value: brl(portfolio.totalPl),
              sub: pct(portfolio.totalPlPct),
              dot: portfolio.totalPl >= 0 ? "#006c49" : "#ba1a1a",
              negative: portfolio.totalPl < 0,
            },
            {
              label: "Ativos",
              value: String(assets.length),
              sub: `${Object.keys(ASSET_TYPE_LABELS).filter(k => assets.some(a => a.asset_type === k)).length} tipo(s)`,
              dot: "#274e82",
              isCount: true,
            },
            {
              label: "IBOV Hoje",
              value: ibov !== null ? pct(ibov) : "—",
              sub: "Índice Bovespa",
              dot: ibov === null ? "#737784" : ibov >= 0 ? "#006c49" : "#ba1a1a",
              isCount: true,
            },
          ].map(card => (
            <div key={card.label} className="rounded-xl p-6 border" style={{ background: "#ffffff", borderColor: "rgba(195,198,213,0.15)" }}>
              <div className="flex justify-between items-start mb-4">
                <div className="p-2.5 rounded-lg" style={{ background: "#eff4ff" }}>
                  <span className="inline-block w-4 h-4 rounded-full" style={{ backgroundColor: card.dot }} />
                </div>
                <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "#737784" }}>{card.label}</span>
              </div>
              {card.sub && <p className="text-xs mb-1" style={{ color: "#737784" }}>{card.sub}</p>}
              <h4
                className="text-2xl font-bold"
                style={{
                  fontFamily: "var(--font-manrope), Manrope, sans-serif",
                  color: "negative" in card && card.negative ? "#ba1a1a" : "#0b1c30",
                }}
              >
                {card.isCount ? card.value : card.value}
              </h4>
            </div>
          ))}
        </section>
      )}

      {/* Assets table */}
      <section className="rounded-xl overflow-hidden border" style={{ background: "#ffffff", borderColor: "rgba(195,198,213,0.15)" }}>
        <div className="px-6 py-4 border-b" style={{ borderColor: "#eff4ff" }}>
          <h3 className="font-bold text-base" style={{ color: "#0b1c30" }}>Carteira</h3>
        </div>

        {isLoading ? (
          <div className="py-16 text-center text-sm" style={{ color: "#737784" }}>Carregando...</div>
        ) : assets.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-sm" style={{ color: "#737784" }}>Nenhum ativo cadastrado.</p>
            <p className="text-xs mt-1" style={{ color: "#737784" }}>Clique em &quot;Adicionar ativo&quot; para começar.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "#eff4ff" }}>
                {["Ticker", "Nome", "Tipo", "Qtd.", "Preço Médio", "Cotação Atual", "Custo Total", "Valor Atual", "P&L", "P&L %", "Var. Hoje", ""].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-widest whitespace-nowrap" style={{ color: "#737784" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {portfolio.rows.map(row => (
                <tr
                  key={row.id}
                  style={{ borderTop: "1px solid #eff4ff" }}
                  onMouseEnter={e => (e.currentTarget.style.background = "#f8f9ff")}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                >
                  <td className="px-4 py-3 font-bold" style={{ color: "#063669" }}>{row.ticker}</td>
                  <td className="px-4 py-3" style={{ color: "#434653" }}>{row.name ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 rounded-full text-xs font-semibold" style={{ background: "#eff4ff", color: "#274e82" }}>
                      {ASSET_TYPE_LABELS[row.asset_type] ?? row.asset_type}
                    </span>
                  </td>
                  <td className="px-4 py-3 tabular-nums" style={{ color: "#434653" }}>{Number(row.quantity).toLocaleString("pt-BR")}</td>
                  <td className="px-4 py-3 tabular-nums" style={{ color: "#434653" }}>{brl(Number(row.avg_price))}</td>
                  <td className="px-4 py-3 tabular-nums font-medium" style={{ color: "#0b1c30" }}>
                    {quotes[row.ticker] ? brl(row.currentPrice) : <span style={{ color: "#737784" }}>—</span>}
                  </td>
                  <td className="px-4 py-3 tabular-nums" style={{ color: "#434653" }}>{brl(row.cost)}</td>
                  <td className="px-4 py-3 tabular-nums font-semibold" style={{ color: "#0b1c30" }}>{brl(row.current)}</td>
                  <td className="px-4 py-3 tabular-nums font-semibold" style={{ color: row.pl >= 0 ? "#006c49" : "#ba1a1a" }}>
                    {brl(row.pl)}
                  </td>
                  <td className="px-4 py-3 tabular-nums" style={{ color: row.plPct >= 0 ? "#006c49" : "#ba1a1a" }}>
                    {pct(row.plPct)}
                  </td>
                  <td className="px-4 py-3 tabular-nums" style={{ color: row.changePercent === null ? "#737784" : row.changePercent >= 0 ? "#006c49" : "#ba1a1a" }}>
                    {row.changePercent !== null ? pct(row.changePercent) : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => removeMutation.mutate(row.id)}
                      disabled={removeMutation.isPending}
                      className="text-xs px-2 py-1 rounded transition-opacity hover:opacity-70 disabled:opacity-30"
                      style={{ color: "#ba1a1a" }}
                      title="Remover ativo"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: "#eff4ff", borderTop: "2px solid #e5eeff" }}>
                <td colSpan={6} className="px-4 py-3 text-xs font-bold uppercase tracking-widest" style={{ color: "#737784" }}>Total</td>
                <td className="px-4 py-3 tabular-nums font-bold" style={{ color: "#0b1c30" }}>{brl(portfolio.totalCost)}</td>
                <td className="px-4 py-3 tabular-nums font-bold" style={{ color: "#0b1c30" }}>{brl(portfolio.totalCurrent)}</td>
                <td className="px-4 py-3 tabular-nums font-bold" style={{ color: portfolio.totalPl >= 0 ? "#006c49" : "#ba1a1a" }}>
                  {brl(portfolio.totalPl)}
                </td>
                <td className="px-4 py-3 tabular-nums font-bold" style={{ color: portfolio.totalPlPct >= 0 ? "#006c49" : "#ba1a1a" }}>
                  {pct(portfolio.totalPlPct)}
                </td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        )}
      </section>

      <p className="text-xs text-center" style={{ color: "#737784" }}>
        Dados via <a href="https://brapi.dev" target="_blank" rel="noreferrer" className="underline">Brapi.dev</a> · Cotações com delay de mercado · Atualizado automaticamente a cada 15 min
      </p>
    </div>
  );
}
