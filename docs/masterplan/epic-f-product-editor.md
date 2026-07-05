# Epic F — Produkt-Editor (PIM) mit Shopify Write-Back

**Epic-Ziel:** Produkte direkt in Shrymp Logistics pflegen — Titel, Beschreibung,
Varianten, Galerie, Tags, Collections, Metafelder, SEO — und optional zurück zu
Shopify synchronisieren (Standard: AN).

**Reihenfolge:** F.1 (Fundament, implementiert) → F.2 (Optionen-UI) → F.3 (Sync-Pull
erweitern) → F.4 (Medien-Upload).

---

## F.1 — Produkt-Editor + Shopify Push (MVP) ✅

**Ziel:** `/admin/products/new` und `/admin/products/[id]` mit vollständigem
Formular; Speichern schreibt Firestore + optional `productSet`/`productCreate` zu
Shopify.

**Betroffene Dateien:**
- `server/firestore/schema.ts` — erweiterte Product/Variant-Felder, `catalog_sync_to_shopify`
- `server/catalog/` — `editor-types`, `save-product`, `edit-fields` (bestehend)
- `server/shopify/catalog-queries.ts`, `catalog-push.ts`
- `app/admin/products/` — Editor, Actions, Routen
- `app/admin/settings/shopify` — Default-Sync-Toggle

**Akzeptanzkriterien:**
- Bestehendes Produkt bearbeiten und zu Shopify pushen
- Neues Produkt anlegen (productCreate)
- Sync pro Speichern und shop-weit abschaltbar (Default ON)
- Job-Tray-Feedback, kein Inline-Banner

---

## F.2 — Produkt-Optionen (Größe/Farbe) im UI ✅

**Ziel:** Options-Editor wie Shopify (Name + Werte), Varianten-Matrix aus Optionen
generieren.

**Implementiert:** `ProductOptionsPanel`, `variant-matrix.ts`, Optionsspalten in der
Varianten-Tabelle, Auto-Matrix beim Speichern.

---

## F.3 — Voll-Sync zieht Katalog-Inhalte ✅

**Ziel:** `PRODUCTS_PAGE_QUERY` / `sync-catalog-page` spiegelt description, tags,
media, metafields, collections beim Pull.

**Implementiert:** Erweiterte GraphQL-Query, `catalog-mapper.ts`, Sync in
`sync-catalog-page.ts` und `sync.ts`. Lazy-Hydrate nur noch als Fallback für
Altbestand ohne Katalog-Felder.

---

## F.4 — Bild-Upload (staged uploads) ✅

**Ziel:** Datei-Upload statt nur URL; `stagedUploadsCreate` + `productCreateMedia`.

**Implementiert:** `staged-upload.ts`, `uploadProductMediaAction`, Upload-Button im
Editor. Scope `read_files` ergänzt (Reconnect nötig).

---

## F.5 — `products/update` Webhook

**Ziel:** Shopify → Firestore Reconcile für Katalog-Felder (Konflikt: wer gewinnt
wenn lokal ohne Sync editiert wurde).

**Abhängigkeiten:** F.3
