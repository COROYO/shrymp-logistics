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
      className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
    >
      {isPending ? "…" : "Abmelden"}
    </button>
  );
}
