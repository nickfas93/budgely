"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Props = {
  displayName: string;
};

export function DashboardHeader({ displayName }: Props) {
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-zinc-800 bg-zinc-900/80 px-8">
      <span className="text-sm font-medium text-zinc-200">{displayName}</span>
      <button
        type="button"
        onClick={() => void handleSignOut()}
        className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 transition hover:bg-zinc-800"
      >
        Sair
      </button>
    </header>
  );
}
