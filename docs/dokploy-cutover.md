# Lager-App auf Dokploy

Die Logistics-App läuft als ein Container. Firestore-Dokumente liegen in Postgres. Firebase Auth und die DHL-PDFs in Storage bleiben. Die Domain stellst du selbst um. Eine Replica.

Dieser Stand erwartet `DATABASE_URL`. Nicht auf App Hosting deployen, solange die alte Instanz noch die Webhooks annimmt.

## Dienste

- Compose-Dienst aus diesem Repo, Datei `docker-compose.yml`, Service `app`, Port 3000.
- Postgres 16 als eigener Dokploy-Datenbank-Dienst im Netz `dokploy-network`. Dienstname zum Beispiel `lager-postgres`. Die Datenbank steht nicht in der App-Compose-Datei.
- `DATABASE_URL` zeigt auf den Dienstnamen, zum Beispiel `postgres://lager:PASSWORT@lager-postgres:5432/lager`.
- Speicher des App-Containers mindestens 1 GiB.

Traefik-Labels in der Compose-Datei sind auskommentiert. Sobald der Host feststeht, Labels dort eintragen. Labels nur in der Oberfläche können bei einem Recreate fehlen.

## Umgebung

Nur in der Dokploy-Environment-Tabelle, nicht im Git:

- `DATABASE_URL`
- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_SERVICE_ACCOUNT_JSON`
- `SHOPIFY_API_KEY`
- `SHOPIFY_API_SECRET`
- `SHOPIFY_ADMIN_ACCESS_TOKEN` falls gesetzt
- `SHOPIFY_API_VERSION`
- `APP_BASE_URL`
- `CRON_SECRET`
- `SUPER_ADMIN_EMAILS`
- `INPROCESS_JOBS=1`

`NEXT_PUBLIC_FIREBASE_*` müssen schon beim Image-Build gesetzt sein. Cloud-Tasks-Variablen werden nicht mehr gelesen.

## Import

Der Service-Account liegt nur auf der Maschine, die importiert. Er kommt nicht ins Image.

Auf dem Server, nachdem Postgres im Netz `dokploy-network` liegt:

```bash
docker run -d --name lager-pg-proxy --network dokploy-network \
  -p 127.0.0.1:54329:5432 alpine/socat \
  TCP-LISTEN:5432,fork,reuseaddr TCP:lager-postgres:5432
```

Vom Laptop:

```bash
ssh -i ./prv.key -o IdentitiesOnly=yes -L 127.0.0.1:54329:127.0.0.1:54329 root@SERVER
```

```bash
DATABASE_URL='postgres://lager:PASSWORT@127.0.0.1:54329/lager' \
FIREBASE_SERVICE_ACCOUNT_PATH=./serviceAccount.json \
GOOGLE_CLOUD_PROJECT=shrymp-logistics \
node apps/logistics/scripts/migrate-firestore-to-postgres.mjs
```

Jede Zeile `collection count` muss dieselbe Zahl haben wie die folgende Zeile `postgres collection count`. Ein zweiter Lauf überschreibt dieselben IDs. Token-Werte nicht ausgeben.

Danach den Proxy entfernen:

```bash
docker rm -f lager-pg-proxy
```

## Umschalten

1. Der neue Container antwortet. Die Logs zeigen keinen fehlenden `DATABASE_URL`. Ein Schreib- und Lesevorgang auf `documents` geht durch.
2. Import und Zählvergleich sind grün.
3. `APP_BASE_URL` auf die neue HTTPS-URL setzen. Der Health-Job hängt die Shopify-Webhooks auf diese URL um. Bis dahin bleibt Shopify auf `lager.shrymp.de`.
4. Den alten App-Hosting-Prozess stoppen, bevor die neue App Webhooks annimmt. Zwei Allocatoren würden dieselben Orders doppelt anfassen. Firestore bleibt in dem Fenster lesbar.
5. Rollback ist das vorherige App-Hosting-Deployment. `DATABASE_URL` auf dem neuen Image zu löschen startet es nicht wieder auf Firestore.

Jobs laufen im Web-Prozess: Webhooks (Concurrency 4), Allocation mit 2-Sekunden-Bucket und einem Lauf pro Shop, Allocate alle 2 Minuten, Reconcile und Outbox-Retry alle 5 Minuten, Shopify-Health alle 15 Minuten, Outbox-Cleanup und Forecast täglich um 03:00 UTC. Die HTTP-Routen unter `/api/cron/*` bleiben für einen manuellen Aufruf mit `CRON_SECRET`.
