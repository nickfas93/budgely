"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";

export default function SettingsPage() {
  const [name, setName] = useState("");
  const [monthlySalary, setMonthlySalary] = useState("");
  const [whatsappPhone, setWhatsappPhone] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) {
        setLoading(false);
        return;
      }
      const { data: row } = await supabase
        .from("budgely_users")
        .select("name, monthly_salary, whatsapp_phone")
        .eq("id", user.id)
        .maybeSingle();
      if (!cancelled && row) {
        setName(row.name);
        setMonthlySalary(String(row.monthly_salary ?? 0));
        setWhatsappPhone(row.whatsapp_phone ?? "");
      } else if (!cancelled && user.email) {
        setName(user.email.split("@")[0] ?? "");
      }
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      toast.error("Sessão inválida. Faça login novamente.");
      setSaving(false);
      return;
    }
    const salaryNum = Number(String(monthlySalary).replace(",", "."));
    const { error } = await supabase.from("budgely_users").upsert(
      {
        id: user.id,
        name: name.trim(),
        monthly_salary: Number.isFinite(salaryNum) ? salaryNum : 0,
        whatsapp_phone: whatsappPhone.trim() || null,
      },
      { onConflict: "id" },
    );
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Configurações salvas.");
  }

  if (loading) {
    return (
      <p className="text-zinc-400">Carregando…</p>
    );
  }

  return (
    <div className="max-w-lg">
      <h1 className="mb-6 text-2xl font-semibold text-zinc-100">
        Configurações
      </h1>
      <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4">
        <div>
          <label
            htmlFor="name"
            className="mb-1 block text-sm font-medium text-zinc-400"
          >
            Nome
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500"
          />
        </div>
        <div>
          <label
            htmlFor="monthly_salary"
            className="mb-1 block text-sm font-medium text-zinc-400"
          >
            Salário mensal (R$)
          </label>
          <input
            id="monthly_salary"
            name="monthly_salary"
            type="number"
            step="0.01"
            min="0"
            value={monthlySalary}
            onChange={(e) => setMonthlySalary(e.target.value)}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500"
          />
        </div>
        <div>
          <label
            htmlFor="whatsapp_phone"
            className="mb-1 block text-sm font-medium text-zinc-400"
          >
            Telefone WhatsApp (formato: 5511999999999)
          </label>
          <input
            id="whatsapp_phone"
            name="whatsapp_phone"
            type="text"
            inputMode="numeric"
            placeholder="5511999999999"
            value={whatsappPhone}
            onChange={(e) => setWhatsappPhone(e.target.value)}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500"
          />
        </div>
        <button
          type="submit"
          disabled={saving}
          className="mt-2 w-fit rounded-lg bg-zinc-100 px-4 py-2 font-medium text-zinc-900 transition hover:bg-white disabled:opacity-50"
        >
          {saving ? "Salvando…" : "Salvar"}
        </button>
      </form>
    </div>
  );
}
