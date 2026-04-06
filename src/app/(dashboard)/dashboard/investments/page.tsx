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
  renda_fixa: "Renda Fixa",
};

const RF_INDEX_LABELS: Record<string, string> = {
  cdi: "% do CDI",
  selic: "% da Selic",
  ipca: "IPCA+",
  prefixado: "Prefixado",
};

type QuoteData = { price: number; changePercent: number };

type AddForm = {
  ticker: string;
  name: string;
  quantity: string;
  avg_price: string;
  asset_type: InvestmentAsset["asset_type"];
  // renda fixa
  rf_index: "cdi" | "ipca" | "selic" | "prefixado";
  rf_rate: string;
  rf_maturity: string;
  rf_invested: string;
};

const EMPTY_FORM: AddForm = {
  ticker: "",
  name: "",
  quantity: "1",
  avg_price: "0",
  asset_type: "acao",
  rf_index: "cdi",
  rf_rate: "",
  rf_maturity: "",
  rf_invested: "",
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
  const { data: quotesData, isError: quotesError } = useQuery<{ quotes: Record<string, QuoteData>; ibov: number | null; selic: number | null }>({
    queryKey: ["investment-quotes", tickers],
    enabled: assets.length > 0,
    refetchInterval: 15 * 60 * 1000,
    retry: 1,
    queryFn: async () => {
      const res = await fetch(`/api/investments/quotes?tickers=${encodeURIComponent(tickers)}`);
      const data = await res.json() as { quotes?: Record<string, QuoteData>; ibov?: number | null; selic?: number | null; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? "Falha ao buscar cotações");
      return data as { quotes: Record<string, QuoteData>; ibov: number | null; selic: number | null };
    },
  });

  const quotes = quotesData?.quotes ?? {};
  const ibov = quotesData?.ibov ?? null;
  const selic = quotesData?.selic ?? null;

  // Portfolio metrics
  const portfolio = useMemo(() => {
    let totalCost = 0;
    let totalCurrent = 0;
    const rows = assets.map(a => {
      if (a.asset_type === "renda_fixa") {
        const invested = Number(a.rf_invested ?? a.avg_price);
        // Projected annual yield based on index type
        let annualRate = 0;
        if (a.rf_index === "cdi" || a.rf_index === "selic") {
          annualRate = selic !== null ? (selic * (Number(a.rf_rate) / 100)) : Number(a.rf_rate ?? 0);
        } else if (a.rf_index === "prefixado") {
          annualRate = Number(a.rf_rate ?? 0);
        } else if (a.rf_index === "ipca") {
          // Use 4.5% IPCA estimate if no real data available
          annualRate = 4.5 + Number(a.rf_rate ?? 0);
        }
        const projectedAnnual = invested * (annualRate / 100);
        const projectedMonthly = projectedAnnual / 12;
        totalCost += invested;
        totalCurrent += invested + projectedAnnual; // simplified: 1 year projection
        return { ...a, currentPrice: invested, cost: invested, current: invested + projectedAnnual, pl: projectedAnnual, plPct: annualRate, changePercent: null, projectedMonthly, annualRate };
      }
      const q = quotes[a.ticker];
      const currentPrice = q?.price ?? a.avg_price;
      const cost = Number(a.avg_price) * Number(a.quantity);
      const current = currentPrice * Number(a.quantity);
      const pl = current - cost;
      const plPct = cost > 0 ? (pl / cost) * 100 : 0;
      totalCost += cost;
      totalCurrent += current;
      return { ...a, currentPrice, cost, current, pl, plPct, changePercent: q?.changePercent ?? null, projectedMonthly: null, annualRate: null };
    });
    const totalPl = totalCurrent - totalCost;
    const totalPlPct = totalCost > 0 ? (totalPl / totalCost) * 100 : 0;
    return { rows, totalCost, totalCurrent, totalPl, totalPlPct };
  }, [assets, quotes, selic]);

  // Add asset mutation
  const addMutation = useMutation({
    mutationFn: async (f: AddForm) => {
      const isRF = f.asset_type === "renda_fixa";
      const { error } = await supabase.from("investment_assets").insert({
        user_id: userId!,
        ticker: isRF ? (f.name.trim().slice(0, 20).toUpperCase() || "RF") : f.ticker.trim().toUpperCase(),
        name: f.name.trim() || null,
        quantity: isRF ? 1 : parseFloat(f.quantity),
        avg_price: isRF ? parseFloat(f.rf_invested || "0") : parseFloat(f.avg_price),
        asset_type: f.asset_type,
        rf_index: isRF ? f.rf_index : null,
        rf_rate: isRF ? parseFloat(f.rf_rate) : null,
        rf_maturity: isRF && f.rf_maturity ? f.rf_maturity : null,
        rf_invested: isRF ? parseFloat(f.rf_invested) : null,
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

  const isRF = form.asset_type === "renda_fixa";

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (isRF) {
      if (!form.name.trim()) return setFormError("Nome do ativo obrigatório");
      const invested = parseFloat(form.rf_invested);
      if (isNaN(invested) || invested <= 0) return setFormError("Valor investido inválido");
      const rate = parseFloat(form.rf_rate);
      if (isNaN(rate) || rate <= 0) return setFormError("Taxa inválida");
    } else {
      if (!form.ticker.trim()) return setFormError("Ticker obrigatório");
      const qty = parseFloat(form.quantity);
      const price = parseFloat(form.avg_price);
      if (isNaN(qty) || qty <= 0) return setFormError("Quantidade inválida");
      if (isNaN(price) || price <= 0) return setFormError("Preço médio inválido");
    }
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

      {/* Quotes error banner */}
      {quotesError && (
        <div className="rounded-xl px-5 py-3 flex items-center gap-3 text-sm" style={{ background: "#fff7ed", border: "1px solid #fed7aa", color: "#c2410c" }}>
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          <span>Não foi possível carregar cotações da Brapi. Verifique os logs do servidor para detalhes.</span>
        </div>
      )}

      {/* Add form */}
      {showAdd && (
        <div className="rounded-2xl p-6 border" style={{ background: "#ffffff", borderColor: "rgba(195,198,213,0.2)" }}>
          <h2 className="font-bold text-base mb-4" style={{ color: "#0b1c30" }}>Novo ativo</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Tipo — sempre visível primeiro */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-bold mb-1" style={{ color: "#737784" }}>Tipo *</label>
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

              {/* Campos renda variável */}
              {!isRF && (
                <>
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
                    <input type="number" min="0" step="any"
                      className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                      style={{ background: "#eff4ff", color: "#0b1c30", border: "1px solid transparent" }}
                      value={form.quantity}
                      onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))}
                      placeholder="100"
                    />
                  </div>
                  <div className="lg:col-start-1">
                    <label className="block text-xs font-bold mb-1" style={{ color: "#737784" }}>Preço médio (R$) *</label>
                    <input type="number" min="0" step="any"
                      className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                      style={{ background: "#eff4ff", color: "#0b1c30", border: "1px solid transparent" }}
                      value={form.avg_price}
                      onChange={e => setForm(f => ({ ...f, avg_price: e.target.value }))}
                      placeholder="38.50"
                    />
                  </div>
                </>
              )}

              {/* Campos renda fixa */}
              {isRF && (
                <>
                  <div className="lg:col-span-3">
                    <label className="block text-xs font-bold mb-1" style={{ color: "#737784" }}>Nome do ativo *</label>
                    <input
                      className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                      style={{ background: "#eff4ff", color: "#0b1c30", border: "1px solid transparent" }}
                      value={form.name}
                      onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                      placeholder="Ex: Tesouro Selic 2027, CDB Bradesco 110% CDI"
                    />
                  </div>
                </>
              )}
            </div>

            {isRF && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 pt-2 border-t" style={{ borderColor: "#eff4ff" }}>
                <div>
                  <label className="block text-xs font-bold mb-1" style={{ color: "#737784" }}>Índice *</label>
                  <select
                    className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                    style={{ background: "#eff4ff", color: "#0b1c30", border: "1px solid transparent" }}
                    value={form.rf_index}
                    onChange={e => setForm(f => ({ ...f, rf_index: e.target.value as AddForm["rf_index"] }))}
                  >
                    {Object.entries(RF_INDEX_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1" style={{ color: "#737784" }}>
                    Taxa *
                    <span className="ml-1 font-normal" style={{ color: "#737784" }}>
                      {form.rf_index === "cdi" || form.rf_index === "selic" ? "(% do índice, ex: 110)" :
                       form.rf_index === "ipca" ? "(% a.a. sobre IPCA, ex: 6.5)" :
                       "(% a.a., ex: 12.5)"}
                    </span>
                  </label>
                  <input type="number" min="0" step="0.01"
                    className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                    style={{ background: "#eff4ff", color: "#0b1c30", border: "1px solid transparent" }}
                    value={form.rf_rate}
                    onChange={e => setForm(f => ({ ...f, rf_rate: e.target.value }))}
                    placeholder={form.rf_index === "cdi" || form.rf_index === "selic" ? "110" : "12.50"}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1" style={{ color: "#737784" }}>Valor investido (R$) *</label>
                  <input type="number" min="0" step="0.01"
                    className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                    style={{ background: "#eff4ff", color: "#0b1c30", border: "1px solid transparent" }}
                    value={form.rf_invested}
                    onChange={e => setForm(f => ({ ...f, rf_invested: e.target.value }))}
                    placeholder="10000.00"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1" style={{ color: "#737784" }}>Vencimento</label>
                  <input type="date"
                    className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                    style={{ background: "#eff4ff", color: "#0b1c30", border: "1px solid transparent" }}
                    value={form.rf_maturity}
                    onChange={e => setForm(f => ({ ...f, rf_maturity: e.target.value }))}
                  />
                </div>
              </div>
            )}

            <div className="flex items-center gap-3 pt-2">
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

      {/* Selic card — only when there are RF assets or selic is available */}
      {selic !== null && assets.some(a => a.asset_type === "renda_fixa") && (
        <section className="rounded-xl p-5 border flex items-center gap-6" style={{ background: "#ffffff", borderColor: "rgba(195,198,213,0.15)" }}>
          <div className="p-3 rounded-xl shrink-0" style={{ background: "#eff4ff" }}>
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#063669" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider" style={{ color: "#737784" }}>Taxa Selic / CDI atual</p>
            <p className="text-2xl font-bold" style={{ fontFamily: "var(--font-manrope), Manrope, sans-serif", color: "#063669" }}>
              {selic.toFixed(2)}% <span className="text-sm font-normal" style={{ color: "#737784" }}>a.a.</span>
            </p>
          </div>
          <div className="ml-auto text-right">
            <p className="text-xs" style={{ color: "#737784" }}>Via Brapi · atualizado a cada 15 min</p>
            <p className="text-xs mt-0.5" style={{ color: "#737784" }}>Projeções de renda fixa usam esta taxa como base</p>
          </div>
        </section>
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
              {portfolio.rows.map(row => {
                const isRFRow = row.asset_type === "renda_fixa";
                return (
                  <tr
                    key={row.id}
                    style={{ borderTop: "1px solid #eff4ff" }}
                    onMouseEnter={e => (e.currentTarget.style.background = "#f8f9ff")}
                    onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                  >
                    <td className="px-4 py-3 font-bold" style={{ color: "#063669" }}>
                      {isRFRow ? <span style={{ color: "#006c49" }}>RF</span> : row.ticker}
                    </td>
                    <td className="px-4 py-3" style={{ color: "#434653" }}>{row.name ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded-full text-xs font-semibold" style={{ background: isRFRow ? "rgba(0,108,73,0.08)" : "#eff4ff", color: isRFRow ? "#006c49" : "#274e82" }}>
                        {isRFRow
                          ? `RF · ${RF_INDEX_LABELS[row.rf_index ?? ""] ?? row.rf_index ?? "—"}`
                          : (ASSET_TYPE_LABELS[row.asset_type] ?? row.asset_type)}
                      </span>
                    </td>
                    {isRFRow ? (
                      <>
                        <td className="px-4 py-3 tabular-nums text-xs" style={{ color: "#434653" }}>
                          {row.rf_rate != null
                            ? (row.rf_index === "cdi" || row.rf_index === "selic"
                              ? `${row.rf_rate}% do índice`
                              : `${row.rf_rate}% a.a.`)
                            : "—"}
                        </td>
                        <td className="px-4 py-3 tabular-nums" style={{ color: "#434653" }}>{brl(row.cost)}</td>
                        <td className="px-4 py-3 tabular-nums text-xs" style={{ color: "#737784" }}>
                          {row.rf_maturity
                            ? new Date(row.rf_maturity + "T12:00:00").toLocaleDateString("pt-BR")
                            : "—"}
                        </td>
                        <td className="px-4 py-3 tabular-nums" style={{ color: "#434653" }}>—</td>
                        <td className="px-4 py-3 tabular-nums" style={{ color: "#434653" }}>—</td>
                        <td className="px-4 py-3 tabular-nums font-semibold" style={{ color: "#006c49" }}>
                          {row.pl > 0 ? `+${brl(row.pl)}/ano` : "—"}
                        </td>
                        <td className="px-4 py-3 tabular-nums" style={{ color: "#006c49" }}>
                          {row.annualRate != null ? `${row.annualRate.toFixed(2)}%` : "—"}
                          {row.projectedMonthly != null && (
                            <div className="text-[10px]" style={{ color: "#737784" }}>{brl(row.projectedMonthly)}/mês</div>
                          )}
                        </td>
                        <td className="px-4 py-3 tabular-nums" style={{ color: "#737784" }}>—</td>
                      </>
                    ) : (
                      <>
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
                      </>
                    )}
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
                );
              })}
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
