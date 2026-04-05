"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";

const brl = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);

const TIPO_OPTIONS = [
  { value: "Credito", label: "Crédito" },
  { value: "Debito", label: "Débito" },
  { value: "VA", label: "Vale Alimentação (VA)" },
  { value: "VR", label: "Vale Refeição (VR)" },
];
const BANK_OPTIONS_MANUAL = [
  { value: "itau", label: "Itaú" },
  { value: "btg", label: "BTG" },
  { value: "inter", label: "Inter" },
  { value: "alelo", label: "Alelo" },
  { value: "outro", label: "Outro" },
];
const emptyManual = {
  date: new Date().toISOString().slice(0, 10),
  amount: "",
  description: "",
  merchant: "",
  category_id: "",
  tipo: "Credito",
  bank: "itau",
  notes: "",
};

type BankValue = "itau_credit" | "itau_debit" | "alelo";

const BANK_OPTIONS: { value: BankValue; label: string }[] = [
  { value: "itau_credit", label: "Itaú Cartão" },
  { value: "itau_debit", label: "Itaú Conta" },
  { value: "alelo", label: "Alelo" },
];

function statusBadge(status: string) {
  const base = "rounded-full px-2 py-0.5 text-xs font-medium";
  if (status === "completed") {
    return (
      <span className={`${base} bg-emerald-500/20 text-emerald-400`}>
        concluído
      </span>
    );
  }
  if (status === "processing") {
    return (
      <span className={`${base} bg-amber-500/20 text-amber-400`}>
        processando
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className={`${base} bg-red-500/20 text-red-400`}>falhou</span>
    );
  }
  return (
    <span className={`${base} bg-zinc-500/20 text-zinc-400`}>{status}</span>
  );
}

export default function ImportPdfPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<"pdf" | "manual">("pdf");
  const [bank, setBank] = useState<BankValue>("itau_credit");
  const [file, setFile] = useState<File | null>(null);
  const [manualForm, setManualForm] = useState(emptyManual);

  const { data: userId } = useQuery({
    queryKey: ["auth-user-id"],
    queryFn: async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      return user?.id ?? null;
    },
  });

  const { data: history } = useQuery({
    queryKey: ["pdf-imports", userId],
    enabled: !!userId,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("pdf_imports")
        .select("*")
        .eq("user_id", userId!)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data;
    },
  });

  const mutation = useMutation({
    mutationFn: async () => {
      if (!file || !userId) {
        throw new Error("Selecione um PDF e aguarde o carregamento da sessão.");
      }
      const form = new FormData();
      form.append("file", file);
      form.append("bank", bank);
      form.append("user_id", userId);
      const res = await fetch("/api/import", {
        method: "POST",
        body: form,
      });
      const json = (await res.json()) as {
        error?: string;
        imported_count?: number;
        total_transactions?: number;
        duplicates_skipped?: number;
      };
      if (!res.ok) {
        throw new Error(json.error ?? "Falha na importação");
      }
      return json;
    },
    onSuccess: (data) => {
      const skipped = data.duplicates_skipped ?? 0;
      const suffix = skipped > 0 ? ` (${skipped} duplicadas ignoradas)` : "";
      toast.success(
        `${data.imported_count ?? 0} transações importadas com sucesso${suffix}.`,
      );
      setFile(null);
      void queryClient.invalidateQueries({ queryKey: ["pdf-imports"] });
      void queryClient.invalidateQueries({ queryKey: ["transactions"] });
    },
    onError: (e: Error) => {
      toast.error(e.message);
    },
  });

  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      const supabase = createClient();
      const { data } = await supabase.from("categories").select("id, label, icon");
      return data ?? [];
    },
  });

  const manualMutation = useMutation({
    mutationFn: async () => {
      const amount = parseFloat(manualForm.amount);
      if (!manualForm.date || isNaN(amount) || !manualForm.description.trim()) {
        throw new Error("Preencha data, valor e descrição.");
      }
      const res = await fetch("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: manualForm.date,
          amount,
          description: manualForm.description.trim(),
          merchant: manualForm.merchant.trim() || undefined,
          category_id: manualForm.category_id || undefined,
          tipo: manualForm.tipo,
          bank: manualForm.bank,
          notes: manualForm.notes.trim() || undefined,
        }),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Falha ao salvar lançamento");
    },
    onSuccess: () => {
      toast.success("Lançamento salvo com sucesso!");
      setManualForm(emptyManual);
      void queryClient.invalidateQueries({ queryKey: ["transactions"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
      void queryClient.invalidateQueries({ queryKey: ["alelo-transactions"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const busy = mutation.isPending;

  const rows = useMemo(() => history ?? [], [history]);

  return (
    <div className="max-w-3xl space-y-8">
      <div className="flex items-end justify-between">
        <h1 className="text-3xl font-extrabold tracking-tight" style={{ fontFamily: "var(--font-manrope), Manrope, sans-serif", color: "#0b1c30" }}>
          Importar & Lançar
        </h1>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-full w-fit" style={{ background: "#eff4ff" }}>
        {[{ key: "pdf", label: "Importar PDF" }, { key: "manual", label: "Lançamento Manual" }].map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key as "pdf" | "manual")}
            className="px-5 py-2 rounded-full text-sm font-semibold transition-all"
            style={activeTab === tab.key ? { background: "#ffffff", color: "#063669", boxShadow: "0 1px 4px rgba(6,54,105,0.1)" } : { color: "#737784" }}>
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "manual" && (
        <div className="rounded-2xl p-6 border space-y-5" style={{ background: "#ffffff", borderColor: "rgba(195,198,213,0.2)" }}>
          <h2 className="font-bold text-base" style={{ color: "#0b1c30" }}>Novo Lançamento Manual</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Data */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: "#434653" }}>Data *</label>
              <input type="date" value={manualForm.date} onChange={e => setManualForm(f => ({ ...f, date: e.target.value }))}
                className="w-full rounded-lg px-4 py-2.5 text-sm outline-none" style={{ background: "#eff4ff", color: "#0b1c30", border: "none" }} />
            </div>
            {/* Valor */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: "#434653" }}>Valor (R$) * <span className="normal-case font-normal" style={{ color: "#737784" }}>negativo = despesa</span></label>
              <input type="number" step="0.01" placeholder="-42.90" value={manualForm.amount} onChange={e => setManualForm(f => ({ ...f, amount: e.target.value }))}
                className="w-full rounded-lg px-4 py-2.5 text-sm outline-none" style={{ background: "#eff4ff", color: "#0b1c30", border: "none" }} />
            </div>
            {/* Descrição */}
            <div className="sm:col-span-2">
              <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: "#434653" }}>Descrição *</label>
              <input type="text" placeholder="Ex: Almoço restaurante" value={manualForm.description} onChange={e => setManualForm(f => ({ ...f, description: e.target.value }))}
                className="w-full rounded-lg px-4 py-2.5 text-sm outline-none" style={{ background: "#eff4ff", color: "#0b1c30", border: "none" }} />
            </div>
            {/* Estabelecimento */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: "#434653" }}>Estabelecimento</label>
              <input type="text" placeholder="Ex: McDonald's" value={manualForm.merchant} onChange={e => setManualForm(f => ({ ...f, merchant: e.target.value }))}
                className="w-full rounded-lg px-4 py-2.5 text-sm outline-none" style={{ background: "#eff4ff", color: "#0b1c30", border: "none" }} />
            </div>
            {/* Categoria */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: "#434653" }}>Categoria</label>
              <select value={manualForm.category_id} onChange={e => setManualForm(f => ({ ...f, category_id: e.target.value }))}
                className="w-full rounded-lg px-4 py-2.5 text-sm outline-none" style={{ background: "#eff4ff", color: "#0b1c30", border: "none" }}>
                <option value="">— Sem categoria —</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
              </select>
            </div>
            {/* Tipo */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: "#434653" }}>Tipo *</label>
              <select value={manualForm.tipo} onChange={e => setManualForm(f => ({ ...f, tipo: e.target.value }))}
                className="w-full rounded-lg px-4 py-2.5 text-sm outline-none" style={{ background: "#eff4ff", color: "#0b1c30", border: "none" }}>
                {TIPO_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            {/* Banco */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: "#434653" }}>Banco</label>
              <select value={manualForm.bank} onChange={e => setManualForm(f => ({ ...f, bank: e.target.value }))}
                className="w-full rounded-lg px-4 py-2.5 text-sm outline-none" style={{ background: "#eff4ff", color: "#0b1c30", border: "none" }}>
                {BANK_OPTIONS_MANUAL.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            {/* Notas */}
            <div className="sm:col-span-2">
              <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: "#434653" }}>Notas</label>
              <textarea rows={2} placeholder="Observações opcionais..." value={manualForm.notes} onChange={e => setManualForm(f => ({ ...f, notes: e.target.value }))}
                className="w-full rounded-lg px-4 py-2.5 text-sm outline-none resize-none" style={{ background: "#eff4ff", color: "#0b1c30", border: "none" }} />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setManualForm(emptyManual)} className="rounded-xl px-5 py-2.5 text-sm font-semibold border hover:opacity-80" style={{ color: "#434653", borderColor: "#c3c6d5" }}>
              Limpar
            </button>
            <button type="button" onClick={() => manualMutation.mutate()} disabled={manualMutation.isPending}
              className="rounded-xl px-5 py-2.5 text-sm font-bold hover:opacity-90 disabled:opacity-50 transition-opacity" style={{ background: "#063669", color: "#ffffff" }}>
              {manualMutation.isPending ? "Salvando..." : "Salvar Lançamento"}
            </button>
          </div>
        </div>
      )}

      {activeTab === "pdf" && (
        <>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
              <div className="flex-1">
                <label htmlFor="bank" className="mb-1 block text-sm font-medium text-zinc-400">
                  Banco / tipo de extrato
                </label>
                <select id="bank" value={bank} onChange={(e) => setBank(e.target.value as BankValue)} disabled={busy}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-500">
                  {BANK_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div className="flex-1">
                <label htmlFor="pdf" className="mb-1 block text-sm font-medium text-zinc-400">
                  Arquivo PDF
                </label>
                <input id="pdf" type="file" accept=".pdf,application/pdf" disabled={busy}
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="w-full text-sm text-zinc-300 file:mr-3 file:rounded-lg file:border file:border-zinc-600 file:bg-zinc-800 file:px-3 file:py-1.5 file:text-zinc-200" />
              </div>
              <button type="button" disabled={busy || !file || !userId} onClick={() => mutation.mutate()}
                className="rounded-lg bg-zinc-100 px-5 py-2.5 text-sm font-medium text-zinc-900 transition hover:bg-white disabled:opacity-40">
                {busy ? "Importando…" : "Importar"}
              </button>
            </div>
          </div>

          <div>
            <h2 className="mb-3 text-lg font-medium text-zinc-200">Últimas importações</h2>
            {rows.length === 0 ? (
              <p className="text-sm text-zinc-500">Nenhuma importação ainda.</p>
            ) : (
              <ul className="divide-y divide-zinc-800 rounded-xl border border-zinc-800 bg-zinc-900/30">
                {rows.map((row) => (
                  <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                    <span className="text-zinc-300">{row.filename}</span>
                    <span className="text-zinc-500">{row.bank}</span>
                    {statusBadge(row.status)}
                    <span className="text-zinc-400">
                      {row.imported_count ?? 0} / {row.total_transactions ?? "—"} lançamentos
                    </span>
                    <span className="text-xs text-zinc-600">
                      {new Date(row.created_at).toLocaleString("pt-BR")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
