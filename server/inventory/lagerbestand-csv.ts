import "server-only";
import { adminDb } from "@/server/firestore/admin";
import {
  Collections,
  type Batch,
  type Product,
  type Variant,
} from "@/server/firestore/schema";
import { receiveBatch } from "./receive";
import { editBatch } from "./edit-batch";
import { log } from "@/lib/logger";

/**
 * CSV-Spalten für den Lagerbestand-Export/Import. Eine Zeile ist entweder
 * eine **Produktzeile** (Chargennummer leer) oder eine **Chargenzeile**
 * (Chargennummer gefüllt). Beide tragen Produkt- und Varianten-ID, damit
 * eine Chargenzeile immer eindeutig der Variante zugeordnet werden kann.
 */
export const CSV_COLUMNS = [
  "Produkt-ID",
  "Varianten-ID",
  "Name",
  "Variante",
  "SKU",
  "Reserviert",
  "Differenz",
  "Chargennummer",
  "MHD",
  "Produktionsdatum",
  "Menge",
  "Notiz",
] as const;

/**
 * Schlanker Spaltensatz für den Export **ohne Chargen** — eine Zeile pro
 * Variante mit Gesamtbestand statt Chargen-Details. `Menge` ist hier der
 * versandfähige Gesamtbestand der Variante (Σ Chargen), nicht eine Chargenmenge.
 */
export const CSV_COLUMNS_NO_BATCHES = [
  "Produkt-ID",
  "Varianten-ID",
  "Name",
  "Variante",
  "SKU",
  "Menge",
  "Reserviert",
  "Differenz",
] as const;

const CSV_SEPARATOR = ";";

function tsToYmd(t: unknown): string {
  if (!t) return "";
  const o = t as { toDate?(): Date; seconds?: number };
  if (typeof o.toDate === "function") return o.toDate().toISOString().slice(0, 10);
  if (typeof o.seconds === "number")
    return new Date(o.seconds * 1000).toISOString().slice(0, 10);
  return "";
}

/** RFC-4180-Feld escapen (Trennzeichen/Quote/Zeilenumbruch). */
function csvField(value: string | number | null | undefined): string {
  const s = value == null ? "" : String(value);
  if (s.includes(CSV_SEPARATOR) || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function csvRow(cells: Array<string | number | null | undefined>): string {
  return cells.map(csvField).join(CSV_SEPARATOR);
}

/**
 * Baut den kompletten Lagerbestand-CSV: pro Variante zuerst eine Produktzeile,
 * danach je aktiver Charge eine Chargenzeile (FEFO-sortiert, ältestes MHD zuerst).
 * Beginnt mit einem UTF-8-BOM, damit Excel Umlaute korrekt liest.
 */
export type BuildCsvOptions = {
  /** Wenn false, werden nur Produktzeilen exportiert (keine Chargenzeilen). */
  includeBatches?: boolean;
};

export async function buildLagerbestandCsv(
  options: BuildCsvOptions = {},
): Promise<string> {
  const includeBatches = options.includeBatches ?? true;
  const db = adminDb();
  const { loadOrderDemandByVariant } = await import("./reserved");
  const { loadShippableQtyByVariant } = await import("./shippable-stock");
  const [productsSnap, variantsSnap, batchesSnap] = await Promise.all([
    db.collection(Collections.Products).get(),
    db.collection(Collections.Variants).get(),
    db.collection(Collections.Batches).get(),
  ]);

  // Reservierte Menge (offene Order-Nachfrage) und versandfähiger Bestand je
  // Variante — identisch zur Lagerbestand-Tabelle, damit Reserviert/Differenz
  // im Export mit der UI übereinstimmen.
  const variantIds = variantsSnap.docs.map((d) => d.id);
  const [reservedByVariant, shippableByVariant] = await Promise.all([
    loadOrderDemandByVariant(),
    loadShippableQtyByVariant(variantIds),
  ]);

  const products = new Map<string, Product>();
  for (const p of productsSnap.docs) products.set(p.id, p.data() as Product);

  const variantsByProduct = new Map<string, Variant[]>();
  for (const v of variantsSnap.docs) {
    const data = v.data() as Variant;
    const list = variantsByProduct.get(data.product_id);
    if (list) list.push(data);
    else variantsByProduct.set(data.product_id, [data]);
  }

  const batchesByVariant = new Map<string, Batch[]>();
  for (const b of batchesSnap.docs) {
    const data = { ...(b.data() as Batch), id: b.id };
    // Nur aktive, physisch vorhandene Chargen exportieren — leere/abgelaufene
    // Chargen sind Historie und gehören nicht in einen Bestands-Snapshot.
    if (data.status !== "ACTIVE" || data.remaining_qty <= 0) continue;
    const list = batchesByVariant.get(data.variant_id);
    if (list) list.push(data);
    else batchesByVariant.set(data.variant_id, [data]);
  }

  const lines: string[] = [
    csvRow([...(includeBatches ? CSV_COLUMNS : CSV_COLUMNS_NO_BATCHES)]),
  ];

  const sortedProducts = Array.from(products.values())
    .filter((p) => p.status !== "ARCHIVED" && p.is_bundle !== true)
    .sort((a, b) => a.title.localeCompare(b.title));

  for (const product of sortedProducts) {
    const variants = (variantsByProduct.get(product.id) ?? []).sort((a, b) =>
      a.title.localeCompare(b.title),
    );
    for (const variant of variants) {
      const reserved = reservedByVariant.get(variant.id) ?? 0;
      const onHand = shippableByVariant.get(variant.id) ?? 0;

      // Variante ohne Chargen: kompakte Zeile mit Gesamtmenge statt Chargen.
      if (!includeBatches) {
        lines.push(
          csvRow([
            product.id,
            variant.id,
            product.title,
            variant.title,
            variant.sku ?? "",
            onHand,
            reserved,
            onHand - reserved,
          ]),
        );
        continue;
      }

      // Produktzeile: Varianten-Kennzahlen (Reserviert/Differenz), keine
      // Chargen-Felder. Differenz = versandfähiger Bestand − Reserviert.
      lines.push(
        csvRow([
          product.id,
          variant.id,
          product.title,
          variant.title,
          variant.sku ?? "",
          reserved,
          onHand - reserved,
          "",
          "",
          "",
          "",
          "",
        ]),
      );

      const batches = (batchesByVariant.get(variant.id) ?? []).sort((a, b) => {
        const ea = tsToYmd(a.expiry_date);
        const eb = tsToYmd(b.expiry_date);
        if (ea === eb) return a.charge_number.localeCompare(b.charge_number);
        if (!ea) return 1;
        if (!eb) return -1;
        return ea.localeCompare(eb);
      });
      for (const batch of batches) {
        lines.push(
          csvRow([
            product.id,
            variant.id,
            "",
            "",
            "",
            "",
            "",
            batch.charge_number,
            tsToYmd(batch.expiry_date),
            tsToYmd(batch.production_date),
            batch.remaining_qty,
            batch.notes ?? "",
          ]),
        );
      }
    }
  }

  return "﻿" + lines.join("\r\n") + "\r\n";
}

// ----------------------------- Import -----------------------------

/** Minimaler RFC-4180-Parser: erkennt `;` oder `,` am Header automatisch. */
function parseCsv(text: string): string[][] {
  // BOM entfernen.
  const src = text.replace(/^﻿/, "");
  // Trennzeichen aus der ersten Zeile ableiten (mehr `;` oder mehr `,`).
  const firstLine = src.slice(0, src.search(/\r?\n/) === -1 ? src.length : src.search(/\r?\n/));
  const sep = (firstLine.split(";").length >= firstLine.split(",").length ? ";" : ",");

  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
    } else if (c === sep) {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c === "\r") {
      // ignorieren (CRLF) — das folgende \n schließt die Zeile ab.
    } else {
      field += c;
    }
  }
  // Letztes Feld/Zeile, falls keine abschließende Zeilenschaltung.
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Normalisiert ein Datum zu YYYY-MM-DD; akzeptiert auch DD.MM.YYYY. Leer → null. */
function normalizeYmd(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const de = v.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (de) {
    const [, d, m, y] = de;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return null; // ungültig → Aufrufer meldet Fehler
}

export type ImportRowResult = {
  row: number; // 1-basierte Zeilennummer in der Datei
  charge: string;
  status: "created" | "updated" | "skipped" | "error";
  message?: string;
};

export type ImportSummary = {
  totalRows: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  results: ImportRowResult[];
};

/**
 * Wendet einen Lagerbestand-CSV an. Nur **Chargenzeilen** (mit Chargennummer)
 * verändern den Bestand — Produktzeilen werden übersprungen.
 *
 * Pro Chargenzeile:
 *   - Varianten-ID ist Pflicht (Invariante: Charge ⇒ Variante).
 *   - Existiert die Charge (variant_id + chargennummer) bereits, wird sie auf
 *     die angegebene Menge korrigiert (`editBatch` → ADJUSTMENT-Audit).
 *   - Andernfalls wird eine neue Charge angelegt (`receiveBatch`, Menge > 0).
 *
 * Mengen sind das *neue* `remaining_qty` (Soll-Ist-Abgleich), nicht additiv.
 */
export async function applyLagerbestandImport(
  csvText: string,
  userId: string,
): Promise<ImportSummary> {
  const rows = parseCsv(csvText);
  const summary: ImportSummary = {
    totalRows: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
    results: [],
  };
  if (rows.length === 0) return summary;

  // Spalten-Indizes aus dem Header bestimmen (tolerant gegenüber Reihenfolge).
  const header = rows[0]!.map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name.toLowerCase());
  const idx = {
    variantId: col("Varianten-ID"),
    productId: col("Produkt-ID"),
    charge: col("Chargennummer"),
    mhd: col("MHD"),
    production: col("Produktionsdatum"),
    qty: col("Menge"),
    note: col("Notiz"),
  };
  if (idx.variantId === -1 || idx.charge === -1 || idx.qty === -1) {
    summary.errors++;
    summary.results.push({
      row: 1,
      charge: "",
      status: "error",
      message: "Header fehlt erforderliche Spalten (Varianten-ID, Chargennummer, Menge).",
    });
    return summary;
  }

  const db = adminDb();

  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r]!;
    const cell = (i: number) => (i >= 0 && i < cells.length ? cells[i]!.trim() : "");
    const rowNo = r + 1; // 1-basiert inkl. Header

    // Komplett leere Zeile überspringen.
    if (cells.every((c) => c.trim() === "")) continue;

    const charge = cell(idx.charge);
    // Produktzeile (keine Chargennummer) → nichts zu tun.
    if (!charge) continue;

    summary.totalRows++;

    const variantId = cell(idx.variantId);
    if (!variantId) {
      summary.errors++;
      summary.results.push({
        row: rowNo,
        charge,
        status: "error",
        message: "Charge ohne Varianten-ID.",
      });
      continue;
    }

    const qtyRaw = cell(idx.qty);
    const qty = Number(qtyRaw);
    if (!Number.isInteger(qty) || qty < 0) {
      summary.errors++;
      summary.results.push({
        row: rowNo,
        charge,
        status: "error",
        message: `Ungültige Menge: "${qtyRaw}".`,
      });
      continue;
    }

    const mhd = normalizeYmd(cell(idx.mhd));
    if (cell(idx.mhd) && !mhd) {
      summary.errors++;
      summary.results.push({
        row: rowNo,
        charge,
        status: "error",
        message: `Ungültiges MHD: "${cell(idx.mhd)}".`,
      });
      continue;
    }
    const production = normalizeYmd(cell(idx.production));
    if (cell(idx.production) && !production) {
      summary.errors++;
      summary.results.push({
        row: rowNo,
        charge,
        status: "error",
        message: `Ungültiges Produktionsdatum: "${cell(idx.production)}".`,
      });
      continue;
    }
    const note = cell(idx.note) || undefined;

    try {
      // Vorhandene Charge dieser Variante mit gleicher Chargennummer suchen.
      const existingSnap = await db
        .collection(Collections.Batches)
        .where("variant_id", "==", variantId)
        .where("charge_number", "==", charge)
        .limit(1)
        .get();

      if (!existingSnap.empty) {
        const batchId = existingSnap.docs[0]!.id;
        await editBatch(
          batchId,
          {
            remaining_qty: qty,
            expiry_date: mhd ?? undefined,
            // Leeres Datum lässt den Wert unverändert (nicht löschen) — so wipet
            // ein teilbefülltes Sheet keine bestehenden Produktionsdaten.
            production_date: production ?? undefined,
            notes: note,
            reason: "CSV-Import Lagerbestand",
          },
          userId,
        );
        summary.updated++;
        summary.results.push({ row: rowNo, charge, status: "updated" });
      } else {
        if (qty <= 0) {
          summary.skipped++;
          summary.results.push({
            row: rowNo,
            charge,
            status: "skipped",
            message: "Neue Charge mit Menge 0 — übersprungen.",
          });
          continue;
        }
        if (!mhd) {
          summary.errors++;
          summary.results.push({
            row: rowNo,
            charge,
            status: "error",
            message: "Neue Charge benötigt ein MHD.",
          });
          continue;
        }
        await receiveBatch({
          variantId,
          chargeNumber: charge,
          expiryDate: mhd,
          productionDate: production ?? undefined,
          qty,
          note,
          userId,
        });
        summary.created++;
        summary.results.push({ row: rowNo, charge, status: "created" });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.warn("lagerbestand_import_row_failed", { row: rowNo, charge, error: msg });
      summary.errors++;
      summary.results.push({ row: rowNo, charge, status: "error", message: msg });
    }
  }

  log.info("lagerbestand_import_done", {
    userId,
    totalRows: summary.totalRows,
    created: summary.created,
    updated: summary.updated,
    skipped: summary.skipped,
    errors: summary.errors,
  });

  return summary;
}
