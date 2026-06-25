# Monolith

pnpm-Monorepo für Marketing-Webseite und Lager-App (Shopify + Firestore).

## Apps

| App | Pfad | Port | Beschreibung |
|-----|------|------|--------------|
| **Logistics** | `apps/logistics` | 3000 | Interne Kommissionierungs-App |
| **Website** | `apps/website` | 3001 | Marketing-Landing → Weiterleitung zur App |

## Setup

```bash
pnpm install
cp apps/logistics/.env.local.example apps/logistics/.env.local
cp apps/website/.env.local.example apps/website/.env.local
```

## Dev

```bash
pnpm dev              # Logistics (3000)
pnpm dev:website      # Marketing (3001)
```

## Build & Test

```bash
pnpm build            # Logistics
pnpm build:website    # Marketing
pnpm test             # Vitest (Logistics)
```

Firebase-Deploy (Logistics): `firebase deploy` aus dem Repo-Root — `firebase.json` zeigt auf `apps/logistics`.

Details: [CLAUDE.md](./CLAUDE.md), [PROJECT.md](./PROJECT.md).
