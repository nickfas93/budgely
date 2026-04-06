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

type ReviewTx = {
  id: string;
  date: string;
  description: string;
  merchant: string | null;
  amount: number;
  category_id: string | null;
  bank: string | null;
  source: string;
  alelo_wallet_type: string | null;
  status: string;
  // local edit state
  _date?: string;
  _description?: string;
  _merchant?: string;
  _amount?: string;
  _category_id?: string;
  _bank?: string;
  _editing?: boolean;
  _deleted?: boolean;
  _applyToMerchant?: boolean;
};

function statusBadge(status: string) {
  const base = "rounded-full px-2 py-0.5 text-xs font-medium";
  if (status === "completed") return <span className={`${base} bg-emerald-500/20 text-emerald-400`}>concluído</span>;
  if (status === "processing") return <span className={`${base} bg-amber-500/20 text-amber-400`}>processando</span>;
  if (status === "failed") return <span className={`${base} bg-red-500/20 text-red-400`}>falhou</span>;
  return <span className={`${base} bg-zinc-500/20 text-zinc-400`}>{status}</span>;
}

export default function ImportPdfPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<"pdf" | "manual">("pdf");
  const [bank, setBank] = useState<BankValue>("itau_credit");
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [manualForm, setManualForm] = useState(emptyManual);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped && dropped.type === "application/pdf") setFile(dropped);
    else toast.error("Apenas arquivos PDF são aceitos.");
  }

  // Review modal state
  const [reviewImportId, setReviewImportId] = useState<string | null>(null);
  const [reviewRows, setReviewRows] = useState<ReviewTx[]>([]);

  const { data: userId } = useQuery({
    queryKey: ["auth-user-id"],
    queryFn: async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
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

  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      const supabase = createClient();
      const { data } = await supabase.from("categories").select("id, label, icon");
      return data ?? [];
    },
  });

  // Open review modal for a given importId
  async function openReview(importId: string) {
    const res = await fetch(`/api/import/${importId}/transactions`);
    const json = await res.json() as { transactions?: ReviewTx[]; error?: string };
    if (!res.ok || json.error) { toast.error(json.error ?? "Falha ao carregar transações"); return; }
    setReviewRows((json.transactions ?? []).map(t => ({
      ...t,
      _date: t.date,
      _description: t.description,
      _merchant: t.merchant ?? "",
      _amount: String(t.amount),
      _category_id: t.category_id ?? "",
      _bank: t.bank ?? "",
      _editing: false,
      _deleted: false,
    })));
    setReviewImportId(importId);
  }

  // Save single row edit in review
  const saveRowMutation = useMutation({
    mutationFn: async (row: ReviewTx) => {
      const applyToMerchant = !!row._applyToMerchant && !!row._category_id;

      if (applyToMerchant) {
        // 1. Batch: aplica category_id em todas do mesmo estabelecimento
        const batchRes = await fetch(`/api/transactions/${row.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            category_id: row._category_id,
            apply_to_merchant: true,
          }),
        });
        const batchJson = await batchRes.json() as { error?: string; updated_count?: number };
        if (!batchRes.ok) throw new Error(batchJson.error ?? "Falha ao aplicar em massa");

        // 2. Single: salva os outros campos somente nesta transação
        const singleRes = await fetch(`/api/transactions/${row.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            date: row._date,
            description: row._description,
            merchant: row._merchant || null,
            amount: parseFloat(row._amount ?? "0"),
            bank: row._bank || null,
          }),
        });
        const singleJson = await singleRes.json() as { error?: string };
        if (!singleRes.ok) throw new Error(singleJson.error ?? "Falha ao salvar campos individuais");

        return { updated_count: batchJson.updated_count ?? 1 };
      }

      // Sem apply_to_merchant: salva tudo em uma única chamada
      const res = await fetch(`/api/transactions/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: row._date,
          description: row._description,
          merchant: row._merchant || null,
          amount: parseFloat(row._amount ?? "0"),
          category_id: row._category_id || null,
          bank: row._bank || null,
        }),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Falha ao salvar");
      return { updated_count: 1 };
    },
    onSuccess: (data, row) => {
      const count = data?.updated_count ?? 1;
      if (row._applyToMerchant && count > 1) {
        toast.success(`Categoria aplicada a ${count} transações de "${row._merchant || row.description}".`);
      }
      setReviewRows(rows => rows.map(r => r.id === row.id ? { ...r, _editing: false, _applyToMerchant: false } : r));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Delete single row in review (soft delete)
  const deleteRowMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/transactions/${id}`, { method: "DELETE" });
      if (!res.ok) { const j = await res.json() as { error?: string }; throw new Error(j.error ?? "Falha"); }
    },
    onSuccess: (_, id) => {
      setReviewRows(rows => rows.map(r => r.id === id ? { ...r, _deleted: true } : r));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Confirm all remaining (non-deleted) pending rows
  const confirmMutation = useMutation({
    mutationFn: async () => {
      if (!reviewImportId) throw new Error("Import ID ausente");
      const res = await fetch(`/api/import/${reviewImportId}/confirm`, { method: "POST" });
      const json = await res.json() as { confirmed_count?: number; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Falha ao confirmar");
      return json;
    },
    onSuccess: (data) => {
      toast.success(`${data.confirmed_count ?? 0} transações confirmadas!`);
      setReviewImportId(null);
      setReviewRows([]);
      void queryClient.invalidateQueries({ queryKey: ["transactions"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
      void queryClient.invalidateQueries({ queryKey: ["transactions-month-totals"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const mutation = useMutation({
    mutationFn: async () => {
      if (!file || !userId) throw new Error("Selecione um PDF e aguarde o carregamento da sessão.");
      const form = new FormData();
      form.append("file", file);
      form.append("bank", bank);
      form.append("user_id", userId);
      const res = await fetch("/api/import", { method: "POST", body: form });
      const json = (await res.json()) as { error?: string; imported_count?: number; total_transactions?: number; duplicates_skipped?: number; import_id?: string };
      if (!res.ok) throw new Error(json.error ?? "Falha na importação");
      return json;
    },
    onSuccess: async (data) => {
      const skipped = data.duplicates_skipped ?? 0;
      const suffix = skipped > 0 ? ` (${skipped} duplicadas ignoradas)` : "";
      toast.success(`${data.imported_count ?? 0} transações importadas${suffix}. Revise abaixo.`);
      setFile(null);
      void queryClient.invalidateQueries({ queryKey: ["pdf-imports"] });
      // Auto-open review modal
      if (data.import_id) await openReview(data.import_id);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const manualMutation = useMutation({
    mutationFn: async () => {
      const amount = parseFloat(manualForm.amount);
      if (!manualForm.date || isNaN(amount) || !manualForm.description.trim()) throw new Error("Preencha data, valor e descrição.");
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
  const activeReviewRows = reviewRows.filter(r => !r._deleted);

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
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: "#434653" }}>Data *</label>
              <input type="date" value={manualForm.date} onChange={e => setManualForm(f => ({ ...f, date: e.target.value }))}
                className="w-full rounded-lg px-4 py-2.5 text-sm outline-none" style={{ background: "#eff4ff", color: "#0b1c30", border: "none" }} />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: "#434653" }}>Valor (R$) * <span className="normal-case font-normal" style={{ color: "#737784" }}>negativo = despesa</span></label>
              <input type="number" step="0.01" placeholder="-42.90" value={manualForm.amount} onChange={e => setManualForm(f => ({ ...f, amount: e.target.value }))}
                className="w-full rounded-lg px-4 py-2.5 text-sm outline-none" style={{ background: "#eff4ff", color: "#0b1c30", border: "none" }} />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: "#434653" }}>Descrição *</label>
              <input type="text" placeholder="Ex: Almoço restaurante" value={manualForm.description} onChange={e => setManualForm(f => ({ ...f, description: e.target.value }))}
                className="w-full rounded-lg px-4 py-2.5 text-sm outline-none" style={{ background: "#eff4ff", color: "#0b1c30", border: "none" }} />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: "#434653" }}>Estabelecimento</label>
              <input type="text" placeholder="Ex: McDonald's" value={manualForm.merchant} onChange={e => setManualForm(f => ({ ...f, merchant: e.target.value }))}
                className="w-full rounded-lg px-4 py-2.5 text-sm outline-none" style={{ background: "#eff4ff", color: "#0b1c30", border: "none" }} />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: "#434653" }}>Categoria</label>
              <select value={manualForm.category_id} onChange={e => setManualForm(f => ({ ...f, category_id: e.target.value }))}
                className="w-full rounded-lg px-4 py-2.5 text-sm outline-none" style={{ background: "#eff4ff", color: "#0b1c30", border: "none" }}>
                <option value="">— Sem categoria —</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: "#434653" }}>Tipo *</label>
              <select value={manualForm.tipo} onChange={e => setManualForm(f => ({ ...f, tipo: e.target.value }))}
                className="w-full rounded-lg px-4 py-2.5 text-sm outline-none" style={{ background: "#eff4ff", color: "#0b1c30", border: "none" }}>
                {TIPO_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: "#434653" }}>Banco</label>
              <select value={manualForm.bank} onChange={e => setManualForm(f => ({ ...f, bank: e.target.value }))}
                className="w-full rounded-lg px-4 py-2.5 text-sm outline-none" style={{ background: "#eff4ff", color: "#0b1c30", border: "none" }}>
                {BANK_OPTIONS_MANUAL.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
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
          {/* Upload zone */}
          <div className="rounded-2xl border p-8 space-y-6" style={{ background: "#ffffff", borderColor: "rgba(195,198,213,0.2)" }}>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "#eff4ff" }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#063669" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
              </div>
              <h2 className="font-bold text-base" style={{ color: "#0b1c30" }}>Importar Extrato PDF</h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="bank" className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: "#434653" }}>Banco / tipo de extrato</label>
                <select id="bank" value={bank} onChange={(e) => setBank(e.target.value as BankValue)} disabled={busy}
                  className="w-full rounded-lg px-4 py-2.5 text-sm outline-none" style={{ background: "#eff4ff", color: "#0b1c30", border: "none" }}>
                  {BANK_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="pdf" className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: "#434653" }}>Arquivo PDF</label>
                <div
                  className="w-full rounded-lg px-4 py-2 text-sm flex items-center gap-3 cursor-pointer transition-all"
                  style={{
                    background: dragOver ? "#e0eaff" : file ? "#edfbf4" : "#eff4ff",
                    border: dragOver ? "2px dashed #063669" : file ? "2px dashed #006c49" : "2px dashed rgba(195,198,213,0.5)",
                  }}
                  onClick={() => document.getElementById("pdf-input")?.click()}
                  onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={file ? "#006c49" : "#737784"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                  <span style={{ color: file ? "#006c49" : dragOver ? "#063669" : "#737784" }}>
                    {dragOver ? "Solte o arquivo aqui" : file ? file.name : "Clique ou arraste o PDF aqui"}
                  </span>
                  {file && (
                    <button type="button" onClick={e => { e.stopPropagation(); setFile(null); }} className="ml-auto text-xs hover:opacity-70" style={{ color: "#ba1a1a" }}>✕</button>
                  )}
                  <input id="pdf-input" type="file" accept=".pdf,application/pdf" disabled={busy} className="hidden"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <p className="text-xs" style={{ color: "#737784" }}>Formatos aceitos: PDF · máximo 10MB</p>
              <button type="button" disabled={busy || !file || !userId} onClick={() => mutation.mutate()}
                className="rounded-xl px-6 py-2.5 text-sm font-bold hover:opacity-90 disabled:opacity-40 transition-opacity"
                style={{ background: "#063669", color: "#ffffff" }}>
                {busy ? "Importando..." : "Importar PDF"}
              </button>
            </div>
          </div>

          {/* History */}
          <div>
            <h2 className="mb-3 font-bold text-sm uppercase tracking-wider" style={{ color: "#737784" }}>Últimas importações</h2>
            {rows.length === 0 ? (
              <div className="rounded-xl p-8 text-center" style={{ background: "#eff4ff" }}>
                <p className="text-sm" style={{ color: "#737784" }}>Nenhuma importação ainda.</p>
              </div>
            ) : (
              <ul className="rounded-xl border overflow-hidden" style={{ borderColor: "rgba(195,198,213,0.2)" }}>
                {rows.map((row, i) => (
                  <li key={row.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 text-sm"
                    style={{ background: i % 2 === 0 ? "#ffffff" : "#fafbff", borderTop: i > 0 ? "1px solid #eff4ff" : "none" }}>
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: "#eff4ff" }}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#063669" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium truncate text-xs" style={{ color: "#0b1c30" }}>{row.filename}</p>
                        <p className="text-xs" style={{ color: "#737784" }}>{row.bank} · {new Date(row.created_at).toLocaleString("pt-BR")}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 shrink-0">
                      <span className="text-xs" style={{ color: "#434653" }}>{row.imported_count ?? 0} / {row.total_transactions ?? "—"} lançamentos</span>
                      {statusBadge(row.status)}
                      <button
                        onClick={() => void openReview(row.id)}
                        className="text-xs font-bold rounded-full px-3 py-1 transition-opacity hover:opacity-80"
                        style={{ background: "#eff4ff", color: "#063669" }}>
                        Revisar
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      {/* Review Modal */}
      {reviewImportId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)" }}>
          <div className="w-full max-w-5xl max-h-[90vh] flex flex-col rounded-2xl shadow-2xl" style={{ background: "#ffffff" }}>
            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: "#eff4ff" }}>
              <div>
                <h2 className="font-bold text-base" style={{ color: "#0b1c30" }}>Revisar Importação</h2>
                <p className="text-xs mt-0.5" style={{ color: "#737784" }}>
                  {activeReviewRows.length} transação(ões) · Edite ou remova antes de confirmar
                </p>
              </div>
              <button onClick={() => setReviewImportId(null)} className="text-xl font-bold hover:opacity-60" style={{ color: "#737784" }}>×</button>
            </div>

            {/* Table */}
            <div className="overflow-auto flex-1">
              <table className="w-full text-sm">
                <thead className="sticky top-0" style={{ background: "#eff4ff" }}>
                  <tr>
                    {["Data", "Descrição", "Estabelecimento", "Categoria", "Banco", "Valor", ""].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-widest whitespace-nowrap" style={{ color: "#737784" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {reviewRows.map((row) => {
                    if (row._deleted) return (
                      <tr key={row.id} style={{ opacity: 0.35, borderTop: "1px solid #eff4ff" }}>
                        <td colSpan={7} className="px-4 py-2 text-xs line-through" style={{ color: "#737784" }}>
                          {row.description} — removido
                        </td>
                      </tr>
                    );

                    if (row._editing) return (
                      <tr key={row.id} style={{ background: "#f0f7ff", borderTop: "1px solid #eff4ff" }}>
                        <td className="px-2 py-2">
                          <input type="date" value={row._date ?? row.date}
                            onChange={e => setReviewRows(rs => rs.map(r => r.id === row.id ? { ...r, _date: e.target.value } : r))}
                            className="w-full rounded px-2 py-1 text-xs outline-none" style={{ background: "#ffffff", color: "#0b1c30" }} />
                        </td>
                        <td className="px-2 py-2">
                          <input type="text" value={row._description ?? row.description}
                            onChange={e => setReviewRows(rs => rs.map(r => r.id === row.id ? { ...r, _description: e.target.value } : r))}
                            className="w-full rounded px-2 py-1 text-xs outline-none" style={{ background: "#ffffff", color: "#0b1c30" }} />
                        </td>
                        <td className="px-2 py-2">
                          <input type="text" value={row._merchant ?? ""}
                            onChange={e => setReviewRows(rs => rs.map(r => r.id === row.id ? { ...r, _merchant: e.target.value } : r))}
                            className="w-full rounded px-2 py-1 text-xs outline-none" style={{ background: "#ffffff", color: "#0b1c30" }} />
                        </td>
                        <td className="px-2 py-2">
                          <select value={row._category_id ?? ""}
                            onChange={e => setReviewRows(rs => rs.map(r => r.id === row.id ? { ...r, _category_id: e.target.value } : r))}
                            className="w-full rounded px-2 py-1 text-xs outline-none" style={{ background: "#ffffff", color: "#0b1c30" }}>
                            <option value="">— Sem categoria —</option>
                            {categories.map(c => <option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-2">
                          <input type="text" value={row._bank ?? ""}
                            onChange={e => setReviewRows(rs => rs.map(r => r.id === row.id ? { ...r, _bank: e.target.value } : r))}
                            className="w-full rounded px-2 py-1 text-xs outline-none" style={{ background: "#ffffff", color: "#0b1c30" }} />
                        </td>
                        <td className="px-2 py-2">
                          <input type="number" step="0.01" value={row._amount ?? String(row.amount)}
                            onChange={e => setReviewRows(rs => rs.map(r => r.id === row.id ? { ...r, _amount: e.target.value } : r))}
                            className="w-full rounded px-2 py-1 text-xs outline-none" style={{ background: "#ffffff", color: "#0b1c30" }} />
                        </td>
                        <td className="px-2 py-2">
                          <div className="flex flex-col gap-2">
                            {row._category_id && (
                              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                                <input
                                  type="checkbox"
                                  checked={!!row._applyToMerchant}
                                  onChange={e => setReviewRows(rs => rs.map(r => r.id === row.id ? { ...r, _applyToMerchant: e.target.checked } : r))}
                                  className="rounded"
                                  style={{ accentColor: "#063669" }}
                                />
                                <span className="text-[10px] leading-tight whitespace-normal" style={{ color: "#434653" }}>
                                  Aplicar categoria a todos de<br />
                                  <strong style={{ color: "#0b1c30" }}>{row._merchant || row.description}</strong>
                                </span>
                              </label>
                            )}
                            <div className="flex gap-2 whitespace-nowrap">
                              <button onClick={() => saveRowMutation.mutate(row)} disabled={saveRowMutation.isPending}
                                className="text-xs font-bold hover:opacity-70 disabled:opacity-40" style={{ color: "#006c49" }}>
                                {saveRowMutation.isPending ? "..." : "Salvar"}
                              </button>
                              <button onClick={() => setReviewRows(rs => rs.map(r => r.id === row.id ? { ...r, _editing: false, _applyToMerchant: false } : r))}
                                className="text-xs hover:opacity-70" style={{ color: "#737784" }}>
                                Cancelar
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    );

                    return (
                      <tr key={row.id}
                        style={{ borderTop: "1px solid #eff4ff" }}
                        onMouseEnter={e => (e.currentTarget.style.background = "#f8f9ff")}
                        onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                      >
                        <td className="px-4 py-2.5 whitespace-nowrap text-xs" style={{ color: "#434653" }}>
                          {new Date(row.date + "T12:00:00").toLocaleDateString("pt-BR")}
                        </td>
                        <td className="px-4 py-2.5 max-w-[200px]" style={{ color: "#0b1c30" }}>
                          <span className="line-clamp-2 text-xs">{row.description}</span>
                        </td>
                        <td className="px-4 py-2.5 text-xs" style={{ color: "#434653" }}>{row.merchant ?? "—"}</td>
                        <td className="px-4 py-2.5 text-xs" style={{ color: "#737784" }}>
                          {categories.find(c => c.id === row.category_id)?.label ?? "—"}
                        </td>
                        <td className="px-4 py-2.5 text-xs" style={{ color: "#737784" }}>{row.bank ?? "—"}</td>
                        <td className="px-4 py-2.5 text-xs font-bold tabular-nums" style={{ color: row.amount < 0 ? "#ba1a1a" : "#006c49" }}>
                          {brl(row.amount)}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex gap-2">
                            <button onClick={() => setReviewRows(rs => rs.map(r => r.id === row.id ? { ...r, _editing: true } : r))}
                              className="text-xs font-semibold hover:opacity-70" style={{ color: "#063669" }}>✎</button>
                            <button onClick={() => { if (confirm("Remover esta transação?")) deleteRowMutation.mutate(row.id); }}
                              disabled={deleteRowMutation.isPending}
                              className="text-xs font-semibold hover:opacity-70 disabled:opacity-30" style={{ color: "#ba1a1a" }}>✕</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Modal footer */}
            <div className="flex items-center justify-between px-6 py-4 border-t" style={{ borderColor: "#eff4ff" }}>
              <p className="text-xs" style={{ color: "#737784" }}>
                {activeReviewRows.length} para confirmar · {reviewRows.filter(r => r._deleted).length} removida(s)
              </p>
              <div className="flex gap-3">
                <button onClick={() => setReviewImportId(null)} className="px-5 py-2 rounded-xl text-sm font-semibold border hover:opacity-80" style={{ color: "#434653", borderColor: "#c3c6d5" }}>
                  Fechar
                </button>
                <button onClick={() => confirmMutation.mutate()} disabled={confirmMutation.isPending || activeReviewRows.length === 0}
                  className="px-5 py-2 rounded-xl text-sm font-bold hover:opacity-90 disabled:opacity-50 transition-opacity" style={{ background: "#006c49", color: "#ffffff" }}>
                  {confirmMutation.isPending ? "Confirmando..." : `Confirmar ${activeReviewRows.length} transação(ões)`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
