"use server";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import {
  applyLagerbestandImport,
  type ImportSummary,
} from "@/server/inventory/lagerbestand-csv";
import { log } from "@/lib/logger";

export type ImportActionState =
  | { ok: true; summary: ImportSummary }
  | { ok: false; error: string };

export async function importLagerbestandAction(
  formData: FormData,
): Promise<ImportActionState> {
  let user;
  try {
    user = await requireRole("ADMIN");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Keine Datei ausgewählt." };
  }
  if (file.size > 5_000_000) {
    return { ok: false, error: "Datei zu groß (max. 5 MB)." };
  }

  try {
    const text = await file.text();
    const summary = await applyLagerbestandImport(text, user.uid);
    revalidatePath("/admin/lagerbestand");
    revalidatePath("/admin/batches");
    return { ok: true, summary };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.warn("lagerbestand_import_failed", { error: msg });
    return { ok: false, error: msg };
  }
}
