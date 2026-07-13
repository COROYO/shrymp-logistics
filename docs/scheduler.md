# Scheduler & Allocation Infrastructure — Deploy Runbook

Region: **`europe-west3`** · Project: `$GCP_PROJECT_ID`

The app relies on three scheduled HTTP endpoints (Cloud Scheduler) and one
Cloud Tasks queue. This is the production setup for all of them.

---

## 1. Cloud Tasks queue (allocation serialization)

The allocation run must have **exactly one writer**. Webhooks and the cron tick
enqueue runs onto a queue with `maxConcurrentDispatches: 1`; the consumer is
`POST /api/internal/allocation/run`.

```bash
gcloud tasks queues create allocation-runs \
  --location=europe-west3 \
  --max-concurrent-dispatches=1 \
  --max-dispatches-per-second=5
```

If it already exists, ensure concurrency is 1:

```bash
gcloud tasks queues update allocation-runs \
  --location=europe-west3 --max-concurrent-dispatches=1
```

The consumer endpoint verifies an OIDC token minted for
`ALLOCATION_INVOKER_SERVICE_ACCOUNT` with audience `ALLOCATION_TARGET_URL`.
That service account needs `roles/cloudtasks.enqueuer` (to be targeted) and the
enqueueing runtime needs `roles/cloudtasks.enqueuer` on the queue.

---

## 2. Scheduled endpoints (Cloud Scheduler)

All three authenticate via the `CRON_SECRET` env var, passed as `?secret=…` or
`Authorization: Bearer …`. Replace `$APP_URL` with the deployed base URL.

| Job | Schedule | Endpoint | Purpose |
|-----|----------|----------|---------|
| `allocate-tick` | every 2 min | `/api/cron/allocate` | Run allocation **iff** NEW orders exist and no run is in progress. Nearly free when idle. |
| `reconcile-orders` | every 5 min | `/api/cron/reconcile` | Heavier safety net: stuck-NEW re-allocation + LAGER tag-drift repair. |
| `outbox-retry` | every 5 min | `/api/cron/outbox-retry` | Drain pending `shopify_outbox` rows (Shopify inventory/tags/fulfillments). Safety net when inline drains miss. |
| `shopify-health` | every 15 min | `/api/cron/shopify-health` | Re-creates missing webhook subscriptions, flags token revocation. |
| `outbox-cleanup` | daily 03:00 UTC | `/api/cron/outbox-cleanup` | Delete completed/stale outbox rows so the collection doesn't grow forever. |

```bash
# 2-minute allocation tick
gcloud scheduler jobs create http allocate-tick \
  --location=europe-west3 \
  --schedule="*/2 * * * *" \
  --uri="$APP_URL/api/cron/allocate?secret=$CRON_SECRET" \
  --http-method=GET

# 5-minute reconciliation sweep
gcloud scheduler jobs create http reconcile-orders \
  --location=europe-west3 \
  --schedule="*/5 * * * *" \
  --uri="$APP_URL/api/cron/reconcile?secret=$CRON_SECRET" \
  --http-method=GET

# 5-minute Shopify outbox drain
gcloud scheduler jobs create http outbox-retry \
  --location=europe-west3 \
  --schedule="*/5 * * * *" \
  --uri="$APP_URL/api/cron/outbox-retry" \
  --http-method=GET \
  --headers="Authorization=Bearer $CRON_SECRET"

# 15-minute Shopify health check
gcloud scheduler jobs create http shopify-health \
  --location=europe-west3 \
  --schedule="*/15 * * * *" \
  --uri="$APP_URL/api/cron/shopify-health?secret=$CRON_SECRET" \
  --http-method=GET
```

> Prefer to pass the secret via header instead of query string (it won't land in
> access logs): drop `?secret=…` from `--uri` and add
> `--headers="Authorization=Bearer $CRON_SECRET"`.

The 2-min tick guards itself: it skips if an allocation run is already `RUNNING`
(a run stuck >5 min is treated as dead and ignored) and skips if no order is in
`NEW`. It can't pile runs onto the concurrency-1 queue during a backlog.

---

## 3. Required environment variables

| Var | Used by | Notes |
|-----|---------|-------|
| `GCP_PROJECT_ID` | enqueue | Cloud Tasks project. |
| `GCP_LOCATION` | enqueue | e.g. `europe-west3`. |
| `ALLOCATION_QUEUE` | enqueue | `allocation-runs`. |
| `ALLOCATION_TARGET_URL` | enqueue + consumer | Full URL of `/api/internal/allocation/run`; also the OIDC audience. |
| `ALLOCATION_INVOKER_SERVICE_ACCOUNT` | enqueue + consumer | SA email(s) allowed to invoke the consumer (comma-separated). |
| `ALLOCATION_ALLOW_UNAUTHENTICATED` | consumer | Set `1` only for local dev to bypass OIDC. **Never in prod.** |
| `CRON_SECRET` | all cron endpoints | Shared secret for scheduler auth. |

If the `ALLOCATION_*` queue vars are **unset**, `enqueueAllocationRun` falls back
to running the allocation **inline** (synchronous) — fine for local dev, but in
prod the queue must be configured so runs stay serialized.

---

## 4. Firestore indexes

No new composite indexes are required by the scheduler or the batch-at-print
refactor. The relevant queries are covered:

- `orders where internal_status == …` — single field (auto).
- `allocation_runs where status == "RUNNING"` — single field (auto).
- `batches where variant_id in […] and status == "ACTIVE"` — covered by the
  existing `(variant_id, status, expiry_date)` composite in
  `firestore.indexes.json`.

Deploy indexes (if not already): `firebase deploy --only firestore:indexes`.

---

## 5. One-time data migration (batch-at-print refactor)

The refactor moved Charge assignment from allocation-time to slip-print time.
Allocations created by the **old** model (open rows pinned to NEW/SHIP/STOP
orders) must be cleaned up once, after deploy:

```bash
# 1. Inspect — read-only
node --env-file=.env.local scripts/diag-stale-allocations.mjs
# 2. Preview the deletion
node --env-file=.env.local scripts/cleanup-stale-allocations.mjs
# 3. Apply
node --env-file=.env.local scripts/cleanup-stale-allocations.mjs --apply
```

Only legacy rows (`run_id != "assign-on-slip"`) on NEW/SHIP/STOP are removed;
PICKING/PACKED and new print-time assignments are left untouched. Legacy rows
never decremented `batch.remaining_qty`, so no stock restore is needed.
