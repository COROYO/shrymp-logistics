# Epic N — Öffentliche API & Integrationen (erweitern)

**Epic-Ziel:** Offene Schnittstellen für weitere Systeme — die bestehende **read-only** REST-API zu
einer vollwertigen Integrationsplattform mit Schreibzugriff, Outbound-Webhooks, feineren Scopes,
Rate-Limiting und Dokumentation ausbauen.

**Kontext (verifiziert — bereits stark):** Es existiert eine **reife, aber lesende** API:
`GET /api/v1/orders`, `/api/v1/inventory`, `/api/v1/batches` (`app/api/v1/`, `server/api/`), mit
`api_keys`-Collection (ID = SHA-256 des Schlüssels), Scopes `orders:read`/`inventory:read`/`batches:read`,
Bearer-Auth und Verwaltungs-UI (`app/admin/settings/api/`). **Fehlt**: Schreib-Endpoints, weitere
Scopes (Produkte/Kunden/Forecasts), Outbound-Webhooks, Rate-Limiting/Quotas, öffentliche Doku.

**Leitplanke:** bestehendes Auth-/Scope-/Handler-Framework wiederverwenden, nicht ersetzen.

---

## N.1 — Write-Endpoints {#n1}

**Ziel:** Schreibende Operationen über die API (Order-Aktionen, Bestandskorrekturen, Wareneingang,
Produktpflege) — scoped und idempotent.

**Warum / Kontext:** Externe Systeme (ERP, Middleware, Kundenlösungen) müssen nicht nur lesen, sondern
auch anstoßen.

**Betroffene Dateien:** `app/api/v1/*` (erweitern), `server/api/handlers/` (neu je Ressource).

**Umsetzung:**
1. Endpoints z. B.: Order-Statusaktion/Tag, Bestandskorrektur/Wareneingang, Produkt-Upsert ([F](epic-f-product-editor.md)),
   Retoure anlegen ([E.1](epic-e-wms.md#e1)).
2. **Idempotenz** über `Idempotency-Key`-Header (Muster wie Outbox/Shopify).
3. Server-Logik **wiederverwenden** (dieselben Funktionen wie das Admin-UI), nicht duplizieren.
4. Validierung via Zod; klare Fehlercodes.

**Datenmodell:** keine neuen (nutzt bestehende Domänen).

**Tests:** Unit: Write-Endpoint ruft dieselbe Domänenlogik; Idempotenz-Key verhindert Doppelwirkung.

**Akzeptanzkriterien:** Kernaktionen sind sicher, scoped und idempotent per API auslösbar.

**Abhängigkeiten:** [N.2](#n2) (Scopes).

---

## N.2 — Erweiterte Scopes {#n2}

**Ziel:** Feingranulare Lese-/Schreib-Scopes über alle relevanten Ressourcen.

**Warum / Kontext:** Heute nur drei Read-Scopes. Für Write + neue Ressourcen braucht es ein erweitertes,
klar dokumentiertes Scope-Set.

**Betroffene Dateien:** `server/firestore/schema.ts` (`ApiScopeSchema` erweitern); Scope-Checks in
Handlern.

**Umsetzung:** Scopes ergänzen: `orders:write`, `inventory:write`, `products:read/write`,
`customers:read`, `forecasts:read`, `documents:read`, `webhooks:manage`. Least-Privilege je Key;
Migration bestehender Keys unverändert.

**Datenmodell:** erweitertes `ApiScopeSchema`.

**Tests:** Unit: Zugriff ohne passenden Scope → 403; mit Scope → erlaubt.

**Akzeptanzkriterien:** Jede Ressource/Operation ist durch einen passenden Scope geschützt.

**Abhängigkeiten:** keine (Grundlage für [N.1](#n1)).

---

## N.3 — Outbound-Webhooks {#n3}

**Ziel:** Externe Systeme abonnieren Ereignisse (z. B. `order.packed`, `inventory.changed`,
`return.created`) und werden zuverlässig benachrichtigt.

**Warum / Kontext:** Echtzeit-Integration ohne Polling; Gegenstück zu unseren eingehenden Shopify-Webhooks.
Auch Aktion in der Automatisierungs-Engine ([H.3](epic-h-automation.md#h3)).

**Betroffene Dateien:** `server/api/webhooks-out/` (neu); `server/firestore/schema.ts` —
`webhook_subscriptions`, `webhook_deliveries`.

**Umsetzung:**
1. **Subscriptions**: Ziel-URL + Event-Topics + Secret (HMAC-Signatur wie Shopify).
2. **Zustellung** über Outbox-Muster (Retry/Backoff, Dedup, `webhook_deliveries`-Log).
3. Auslösung an denselben Ereignispunkten wie [H.2](epic-h-automation.md#h2).

**Datenmodell:** `webhook_subscriptions`, `webhook_deliveries` (mit `expires_at`-TTL).

**Tests:** Unit: HMAC-Signatur; Retry bei 5xx; Dedup.

**Akzeptanzkriterien:** Ein Abonnent erhält signierte, zuverlässig zugestellte Event-Callbacks.

**Abhängigkeiten:** [N.2](#n2); Ereignisse aus [H.2](epic-h-automation.md#h2).

---

## N.4 — Rate-Limiting & Quotas {#n4}

**Ziel:** Schutz vor Überlast und faire Nutzung je API-Key.

**Warum / Kontext:** Heute **kein** Rate-Limiting — ein Key kann das System belasten.

**Betroffene Dateien:** `server/api/rate-limit.ts` (neu); Integration in den API-Handler.

**Umsetzung:** Pro-Key-Limits (Requests/Minute, Tageskontingent); Standard-Header
(`RateLimit-*`, `Retry-After`); Limits je Key/Plan konfigurierbar; Zähler in Firestore/Memory
(Kosten/Genauigkeit abwägen).

**Datenmodell:** `api_keys.rate_limit`; Zählerspeicher.

**Tests:** Unit: Überschreitung → 429 + `Retry-After`.

**Akzeptanzkriterien:** Übermäßige Nutzung wird sauber gedrosselt; legitime Nutzung unbeeinträchtigt.

**Abhängigkeiten:** keine.

---

## N.5 — API-Doku & Developer-Portal {#n5}

**Ziel:** Öffentliche, maschinen- und menschenlesbare Dokumentation (OpenAPI) für Integratoren.

**Warum / Kontext:** „Offene API-Schnittstellen für weitere Systeme" braucht Doku, sonst wird sie nicht
genutzt.

**Betroffene Dateien:** `app/developers/` (neu, öffentlich) oder Admin-Doku-Seite;
`openapi.yaml`/generiert.

**Umsetzung:** OpenAPI-Spec aus den v1-Routen pflegen/generieren; Doku-Seite (Endpoints, Scopes,
Auth, Webhooks, Beispiele); Changelog/Versionierung (`/api/v1`).

**Datenmodell:** keine.

**Tests:** Spec-Lint; Beispiel-Requests funktionieren gegen die echten Endpoints.

**Akzeptanzkriterien:** Ein externer Entwickler kann anhand der Doku ohne Rückfragen integrieren.

**Abhängigkeiten:** [N.1](#n1)–[N.3](#n3).
