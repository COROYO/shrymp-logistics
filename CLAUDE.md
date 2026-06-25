# Monolith Lager — Project Conventions

Internal warehouse picking/packing app for **Ikrinka (Monolith Caviar)**.
Greenfield Next.js 16 + Firestore project.

## Stack

- **Next.js 16** (App Router) + TypeScript + Tailwind 4
- **Firestore** as DB; **Firebase Auth** with custom claims for `role` (`ADMIN` | `LAGER`)
- **Firebase Hosting** + **Cloud Functions Gen 2** (Node 22, region `europe-west3`)
- **Cloud Tasks** queue `allocation-runs` for serialized allocation runs
- **Shopify Custom App** — pre-installed in the merchant's Shopify Admin.
  All credentials come from ENV: `SHOPIFY_ADMIN_ACCESS_TOKEN` for the Admin
  API, `SHOPIFY_API_SECRET` for webhook HMAC verification. No OAuth flow.
- Tests with **Vitest** + **fast-check** (property-based)

## Next.js 16 specifics

> The Next.js installed here has breaking changes vs. older versions. Read `node_modules/next/dist/docs/` before guessing.

- `middleware.ts` is **gone** — use `proxy.ts` in `apps/logistics/`.
- `params` / `searchParams` are **Promises** in pages/route handlers.
- Server Components default; client components require `"use client"`.

## Project layout

```
apps/
  logistics/                      # Warehouse app (Next.js, deployed via Firebase)
    app/                          # admin/, lager/, api/, login/, setup/
    server/                       # Firestore, Shopify, allocation, picking
    lib/                          # auth, firebase client, logger
    proxy.ts                      # Next.js 16 proxy — cookie presence check
    apphosting.yaml
  website/                        # Marketing site (public funnel → logistics app)

functions/                        # Firebase Functions (deployed separately)
firebase.json, .firebaserc, firestore.rules, firestore.indexes.json
pnpm-workspace.yaml
```

## Conventions

- **Default-deny Firestore rules.** All client reads/writes go through server
  code using the Admin SDK. No direct browser-to-Firestore access.
- **Schemas live in `server/firestore/schema.ts`.** Use the `Collections`
  constant for collection names; never hard-code strings elsewhere.
- **All money/quantity values are integers** (smallest unit). Inventory is
  always whole-piece counts.
- **Timestamps:** server-set via `FieldValue.serverTimestamp()` on write;
  Zod schemas accept Firestore Timestamps, ISO strings, and Date.
- **Logging:** use `lib/logger.ts` (single-line JSON for Cloud Logging).
- **Comments:** sparse, only where the *why* is non-obvious.

## Allocation invariants

The allocation run decides **SHIP/STOP only** and reserves quantity at the
**variant** level — it does NOT bind Chargen. It runs in a single Cloud
Function consumer with queue concurrency = 1. See `server/allocation/`.

- **All-or-nothing** per order (no partial fulfillment).
- **EXPRESS_DHL** orders are allocated first, ignoring everything else.
- SHIP iff `variant.on_hand_total - reserved_total` covers the order
  (chronological, oldest order first; tiebreak by order id).
- `reserved_total` = Σ line-item qty over orders in `SHIP`/`PICKING`.
  Hot path adjusts it by in-memory delta; RECONCILE/MANUAL recompute it
  from order state. The run is deterministic for a given snapshot.

### Charge (batch) assignment — at slip print, not allocation

Chargen are pinned **only when the packing slip is printed**
(`server/picking/assign-batches.ts`), FEFO (oldest MHD first), in one
transaction over the batch docs (the serialization point against concurrent
prints). This guarantees the oldest Charge ships first regardless of the order
in which staff pack. `batch.remaining_qty` = *assignable* units, decremented at
assignment and restored on cancel/STOP-flip; physical `on_hand_total` only
drops at packing-confirm. Reprints reuse the same Charge (idempotent).

## Commands

- `pnpm dev` / `pnpm dev:logistics` — logistics app (port 3000)
- `pnpm dev:website` — marketing site (port 3001)
- `pnpm build` — production build (logistics)
- `pnpm lint` — ESLint (all apps)
- `pnpm test` — Vitest (logistics)
- `firebase emulators:start` — local Firestore/Auth/Functions emulators (from repo root)

Deploy / Cloud Scheduler / allocation-queue setup: see `docs/scheduler.md`.

## Plan

The originating multi-milestone plan lives at
`~/.claude/plans/ok-wir-haben-gro-es-encapsulated-conway.md`.
