"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { clientAuth } from "@/lib/firebase/client";

export function LogoutButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  async function handleLogout() {
    await signOut(clientAuth()).catch(() => {});
    await fetch("/api/auth/session", { method: "DELETE" }).catch(() => {});
    startTransition(() => {
      router.replace("/login");
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={isPending}
      className="rounded-md border border-white/30 bg-transparent px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/80 transition hover:border-white hover:text-white disabled:opacity-50"
    >
      {isPending ? "…" : "Abmelden"}
    </button>
  );
}
