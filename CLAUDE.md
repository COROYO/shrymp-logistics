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

- `middleware.ts` is **gone** — use `proxy.ts` at project root.
- `params` / `searchParams` are **Promises** in pages/route handlers.
- Server Components default; client components require `"use client"`.

## Project layout

```
app/
  layout.tsx, page.tsx            # root: redirect by role
  login/                          # public
  admin/                          # ADMIN-only (gated in layout)
  lager/                          # LAGER + ADMIN (gated in layout)
  api/webhooks/shopify/route.ts   # HMAC (via SHOPIFY_API_SECRET), dedupe, enqueue
  api/auth/session/route.ts       # POST: create session cookie, DELETE: clear
  api/setup/bootstrap-admin/route.ts  # first-time admin bootstrap (no auth)

lib/
  auth/session.ts                 # getSessionUser, requireRole
  firebase/client.ts              # browser SDK init
  logger.ts                       # structured JSON logger

server/
  firestore/schema.ts             # Zod schemas + Collections constants
  firestore/admin.ts              # Admin SDK init (server-only)
  shopify/auth.ts                 # shop-domain validation
  shopify/                        # client, mutations, queries, hmac, outbox
  allocation/                     # runAllocation (pure), run (Firestore), enqueue
  inventory/receive.ts            # Wareneingang (txn-atomic batch + audit)
  pdf/                            # react-pdf packing slip (M8)

functions/                        # Firebase Functions (deployed separately)
  src/shopifyWebhook.ts
  src/runAllocation.ts
  src/nightlyReconcile.ts
  src/outboxRetry.ts

proxy.ts                          # Next.js 16 proxy — cookie presence check only
firebase.json, .firebaserc, firestore.rules, firestore.indexes.json
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

The allocation algorithm runs in a single Cloud Function consumer with
queue concurrency = 1, so there is only ever one writer to `batches` and
`allocations`. Wareneingang and Packing use Firestore transactions on
`batches`. See `server/allocation/runAllocation.ts`.

- **All-or-nothing** per order (no partial fulfillment).
- **EXPRESS_DHL** orders are allocated first, ignoring everything else.
- **FEFO** within an allocation: oldest MHD first.
- Decisions are committed transactionally; the run is deterministic
  given the same `(orders, batches)` snapshot.

## Commands

- `pnpm dev` — Next.js dev server (port 3000)
- `pnpm build` — production build
- `pnpm lint` — ESLint
- `pnpm test` — Vitest
- `firebase emulators:start` — local Firestore/Auth/Functions emulators

## Plan

The originating multi-milestone plan lives at
`~/.claude/plans/ok-wir-haben-gro-es-encapsulated-conway.md`.
