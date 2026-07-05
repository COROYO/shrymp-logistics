# Epic L — CRM & Service-Desk (mit KI-Antworten)

**Epic-Ziel:** Ein CRM- und Ticketsystem inkl. Kundenkommunikation per E-Mail und **KI-gestützten
Antwortvorschlägen** — damit Support, Kundenhistorie und Verkauf in einem System zusammenlaufen.

**Kontext (verifiziert):** **Vorhanden**: Kunden-Aggregation (`server/customers/aggregate.ts`,
`app/admin/customers/`) — Orders je Kunde, Umsatz, Erst-/Letztbestellung; Kundendaten sind **denormalisiert
auf der Order** (`order.customer`), es gibt **keine** eigene `customers`-Collection. **Fehlt**: eigene
Kundenstammdaten, E-Mail-Versand/-Empfang, Ticketing, KI-Antworten.

**Hinweis KI:** Antwortvorschläge nutzen die **Anthropic API** (Claude). Modellwahl:
**Sonnet 5** (`claude-sonnet-5`) für Qualität, **Haiku 4.5** (`claude-haiku-4-5-20251001`) für schnelle/
günstige Entwürfe. Vor Umsetzung die `claude-api`-Referenz lesen. Immer **Human-in-the-Loop** (Vorschlag,
kein Auto-Versand).

---

## L.1 — Kunden-Stammdaten / CRM-Kern {#l1}

**Ziel:** Echte, kanalübergreifende Kundenstammdaten statt nur order-denormalisierter Daten.

**Warum / Kontext:** Für CRM/Ticketing/Marketing braucht es ein stabiles Kundenobjekt, das Bestellungen
aus **allen** Kanälen ([G](epic-g-multichannel.md)) bündelt.

**Betroffene Dateien:**
- `server/firestore/schema.ts` — `customers`-Collection.
- `server/customers/` (erweitern) — Aggregation → echte Stammdaten (Backfill aus Orders).
- `app/admin/customers/` (erweitern) — Profil, Segmente, Tags.

**Umsetzung:**
1. **`customers/{id}`**: Identität (E-Mail/Name/Adressen), verknüpfte Channel-Kundennummern,
   Kennzahlen (LTV, Order-Count, RFM), Tags/Segmente, Kommunikationspräferenzen (Opt-in/-out).
2. **Matching** über Kanäle (E-Mail als Schlüssel; Merge-Regeln); Backfill aus bestehenden Orders.
3. Order ↔ Customer verknüpfen (bestehende Denormalisierung bleibt als Cache).

**Datenmodell:** `customers`-Collection; `order.customer_id`.

**Tests:** Unit: Matching/Merge (gleiche E-Mail über zwei Kanäle → ein Kunde); Kennzahlen korrekt.

**Akzeptanzkriterien:** Ein Kunde bündelt seine Bestellungen kanalübergreifend mit korrekten Kennzahlen.

**Abhängigkeiten:** profitiert stark von [G.1](epic-g-multichannel.md#g1) (Channel).

---

## L.2 — E-Mail-Anbindung (Amazon SES, später) {#l2}

**Ziel:** E-Mails senden (und empfangen) — transaktional und im Support.

> **Timing/Entscheidung:** **Nicht im ersten Wurf** — bewusst zurückgestellt. Provider ist **Amazon
> SES**. Bis dahin laufen Benachrichtigungen/Ticketing ohne eigenen Mailversand (Job-Tray/UI); Features,
> die Mail brauchen, sind entsprechend „später" markiert.

**Warum / Kontext:** Es gibt **keine** Mail-Infra. Voraussetzung für Ticket-Inbound ([L.3](#l3)),
Benachrichtigungen ([E.2](epic-e-wms.md#e2)/[E.5](epic-e-wms.md#e5)) und Belegversand
([J.2](epic-j-warenwirtschaft.md#j2)) — diese Teile warten auf SES.

**Betroffene Dateien:**
- `server/email/` (neu) — **SES**-Anbindung + Templates.
- Config: SES-Credentials/Domain-Verifizierung; Inbound via SES (Receipt-Rules → S3/Lambda/Webhook).

**Umsetzung:**
1. **Outbound** über **Amazon SES** (dünne Abstraktion, aber SES als konkrete Implementierung).
2. **Templates** (mehrsprachig via `next-intl`): Bestell-/Versand-/Retouren-Benachrichtigung.
3. **Inbound** (für [L.3](#l3)): SES-Empfang → eingehende Mails einem Kunden/Ticket zuordnen.
4. Zustell-/Bounce-/Complaint-Handling (SES-Notifications); Opt-out respektieren.

**Datenmodell:** `email_messages/{id}` (Richtung, Kunde/Ticket-Ref, Status).

**Tests:** Unit: Template-Rendering; Inbound-Zuordnung zu Kunde/Ticket.

**Akzeptanzkriterien:** Wenn aktiviert, gehen Transaktionsmails über SES zuverlässig raus und eingehende
Mails werden zugeordnet.

**Abhängigkeiten:** [L.1](#l1); **zeitlich nachgelagert** (nicht Teil des ersten Umsetzungsschubs).

---

## L.3 — Ticketsystem / Helpdesk {#l3}

**Ziel:** Support-Tickets mit Bezug zu Kunde/Bestellung, Status, Zuweisung und Verlauf.

**Warum / Kontext:** Zentralisiert Kundenkommunikation; Grundlage für KI-Antworten.

**Betroffene Dateien:**
- `server/tickets/` (neu); `server/firestore/schema.ts` — `tickets`, `ticket_messages`.
- `app/admin/tickets/` (neu) — Inbox/Detail.

**Umsetzung:**
1. **`tickets/{id}`**: Kunde/Order-Ref, Betreff, Status (OPEN|PENDING|SOLVED), Zuweisung, Priorität,
   Kanal (E-Mail/…); `ticket_messages` als Thread.
2. **Ingest** aus [L.2](#l2)-Inbound (neue Mail → neues/bestehendes Ticket).
3. Kontext-Panel: Bestellungen/Sendungen/Retouren des Kunden direkt am Ticket.

**Datenmodell:** `tickets`, `ticket_messages`.

**Tests:** Unit: Mail erzeugt/aktualisiert Ticket; Statusübergänge.

**Akzeptanzkriterien:** Support kann Tickets bearbeiten, mit vollem Kunden-/Bestellkontext.

**Abhängigkeiten:** [L.1](#l1), [L.2](#l2).

---

## L.4 — KI-Antwortvorschläge {#l4}

**Ziel:** Zu jedem Ticket generiert die KI einen Antwortentwurf, den der Mitarbeiter prüft/anpasst/sendet.

**Warum / Kontext:** Beschleunigt Support massiv. **Human-in-the-Loop**, kein Auto-Versand.

**Betroffene Dateien:** `server/tickets/ai-suggest.ts` (neu); UI im Ticket-Detail.

**Umsetzung:**
1. **Kontext**: Ticket-Thread + Kundenhistorie (Bestellungen/Sendungen/Retouren/Status) als Prompt-Kontext.
2. **Modell**: Anthropic API — **Sonnet 5** für Qualität, **Haiku 4.5** für schnelle Entwürfe (konfigurierbar).
3. **Guardrails**: nur Vorschlag; sensible Aktionen (Refund/Storno) nie automatisch; PII-bewusst;
   Sprache = Kundensprache.
4. Feedback-Schleife: akzeptiert/bearbeitet → optional zur Qualitätsmessung protokollieren.

**Datenmodell:** `ticket_messages.ai_draft` (Entwurf + Status).

**Tests:** Unit: Prompt-Kontext-Assembly enthält relevante Order-Daten; Guardrail blockt Auto-Aktionen.

**Akzeptanzkriterien:** Für ein Ticket erscheint ein brauchbarer, kontextbezogener Antwortentwurf, den
der Mitarbeiter mit einem Klick übernehmen/senden kann.

**Abhängigkeiten:** [L.3](#l3); `claude-api`-Referenz lesen.

---

## L.5 — Kommunikations-Historie & Vorlagen {#l5}

**Ziel:** Vollständige Kommunikations-Timeline je Kunde plus wiederverwendbare Textbausteine.

**Warum / Kontext:** Support-Effizienz und Konsistenz; ergänzt KI-Entwürfe um kuratierte Vorlagen.

**Betroffene Dateien:** `app/admin/customers/[key]/` (erweitern) — Timeline; `server/tickets/canned.ts`
(neu) — Vorlagen.

**Umsetzung:** Alle E-Mails/Tickets je Kunde chronologisch; Canned Responses (mehrsprachig, mit
Platzhaltern); Vorlagen auch als KI-Ausgangsbasis.

**Datenmodell:** `canned_responses/{id}`.

**Tests:** Unit: Timeline-Aggregation; Platzhalter-Ersetzung.

**Akzeptanzkriterien:** Pro Kunde ist die gesamte Kommunikation sichtbar; Vorlagen beschleunigen
Antworten.

**Abhängigkeiten:** [L.2](#l2), [L.3](#l3).
