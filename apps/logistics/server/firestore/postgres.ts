// Firestore-shaped document store on Postgres.
// Flat collections only. Dates are stored as ISO strings and revived on read
// so existing `toDate()` / `seconds` checks keep working.
// Expression index: (collection, data->>'shop_id') covers orders, variants,
// batches, allocations, and shopify_outbox.

import "server-only";
import { randomBytes } from "node:crypto";
import pg from "pg";

const { Pool } = pg;

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

type SqlClient = {
  query: (
    text: string,
    values?: unknown[],
  ) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
};

export type SqlPool = SqlClient & {
  connect: () => Promise<SqlClient & { release: () => void }>;
};

type Filter =
  | { op: "eq"; field: string; value: unknown }
  | { op: "in"; field: string; value: unknown[] }
  | { op: "cmp"; field: string; cmp: ">=" | "<=" | ">" | "<"; value: unknown }
  | { op: "containsAny"; field: string; value: unknown[] }
  | { op: "idGte"; value: string }
  | { op: "idLt"; value: string };

type Order = { field: string; dir: "asc" | "desc" };
type Cursor = { id: string; data: Record<string, unknown> };

type BatchOp =
  | { kind: "set"; ref: DocRef; data: Record<string, unknown>; merge: boolean }
  | { kind: "update"; ref: DocRef; data: Record<string, unknown> }
  | { kind: "delete"; ref: DocRef };

const ISO_DATE_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

const schemas = new WeakMap<object, Promise<void>>();

const globalStore = globalThis as typeof globalThis & {
  lagerPgPool?: pg.Pool;
  lagerPgDb?: PgDb;
};

function pool(): pg.Pool {
  if (!globalStore.lagerPgPool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    globalStore.lagerPgPool = new Pool({ connectionString: url, max: 10 });
  }
  return globalStore.lagerPgPool;
}

async function ensureSchema(client: SqlClient): Promise<void> {
  const existing = schemas.get(client);
  if (existing) return existing;
  const pending = (async () => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS documents (
        collection text NOT NULL,
        id text NOT NULL,
        data jsonb NOT NULL,
        PRIMARY KEY (collection, id)
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS documents_collection_shop_id
      ON documents (collection, (data->>'shop_id'))
    `);
    // Optimistic concurrency for BulkWriter lastUpdateTime. Existing rows
    // get the migration time; the next write moves it forward.
    await client.query(`
      ALTER TABLE documents
      ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
    `);
  })().catch((error: unknown) => {
    schemas.delete(client);
    throw error;
  });
  schemas.set(client, pending);
  return pending;
}

function constructorName(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  return (value as { constructor?: { name?: string } }).constructor?.name ?? null;
}

function isServerTimestamp(value: unknown): boolean {
  return constructorName(value) === "ServerTimestampTransform";
}

function isDelete(value: unknown): boolean {
  return constructorName(value) === "DeleteTransform";
}

function incrementOf(value: unknown): number | null {
  if (constructorName(value) !== "NumericIncrementTransform") return null;
  const operand = (value as { operand?: unknown }).operand;
  return typeof operand === "number" ? operand : null;
}

function arrayElements(value: unknown, name: string): unknown[] | null {
  if (constructorName(value) !== name) return null;
  const elements = (value as { elements?: unknown }).elements;
  return Array.isArray(elements) ? elements : [];
}

function isTimestamp(value: unknown): value is { toDate: () => Date } {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { toDate?: unknown }).toDate === "function" &&
    ("_seconds" in (value as object) || "seconds" in (value as object))
  );
}

function normalize(value: unknown): Json | undefined {
  if (value === undefined) return undefined;
  if (isDelete(value)) return undefined;
  if (isServerTimestamp(value)) return new Date().toISOString();
  const union = arrayElements(value, "ArrayUnionTransform");
  if (union) {
    return union.map((entry) => {
      const next = normalize(entry);
      return next === undefined ? null : next;
    });
  }
  if (arrayElements(value, "ArrayRemoveTransform")) return [];
  const increment = incrementOf(value);
  if (increment != null) return increment;
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return value.toISOString();
  if (isTimestamp(value)) return value.toDate().toISOString();
  if (Array.isArray(value)) {
    return value.map((entry) => {
      const next = normalize(entry);
      return next === undefined ? null : next;
    });
  }
  if (typeof value === "object") {
    const out: { [key: string]: Json } = {};
    for (const [key, entry] of Object.entries(value)) {
      const next = normalize(entry);
      if (next !== undefined) out[key] = next;
    }
    return out;
  }
  return null;
}

function updatedAtIso(value: unknown): string | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === "string") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return undefined;
}

function reviveTime(iso: string): Record<string, unknown> {
  const date = new Date(iso);
  const ms = date.getTime();
  const seconds = Math.floor(ms / 1000);
  const nanos = (ms % 1000) * 1_000_000;
  return {
    toDate: () => new Date(iso),
    toMillis: () => ms,
    seconds,
    nanoseconds: nanos,
    _seconds: seconds,
    _nanoseconds: nanos,
  };
}

function hydrate(value: unknown): unknown {
  if (typeof value === "string" && ISO_DATE_TIME.test(value)) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return reviveTime(value);
    return value;
  }
  if (Array.isArray(value)) return value.map((entry) => hydrate(entry));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) out[key] = hydrate(entry);
    return out;
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return undefined;
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function applySentinel(data: Record<string, unknown>, key: string, value: unknown): void {
  if (value === undefined || isDelete(value)) {
    delete data[key];
    return;
  }
  const increment = incrementOf(value);
  if (increment != null) {
    data[key] = (Number(data[key]) || 0) + increment;
    return;
  }
  const union = arrayElements(value, "ArrayUnionTransform");
  if (union) {
    const current = Array.isArray(data[key]) ? (data[key] as unknown[]) : [];
    const next = [...current];
    for (const entry of union) {
      const normalized = normalize(entry);
      if (!next.some((item) => sameJson(item, normalized))) next.push(normalized);
    }
    data[key] = next;
    return;
  }
  const remove = arrayElements(value, "ArrayRemoveTransform");
  if (remove) {
    const current = Array.isArray(data[key]) ? (data[key] as unknown[]) : [];
    const gone = new Set(remove.map((entry) => JSON.stringify(normalize(entry))));
    data[key] = current.filter((item) => !gone.has(JSON.stringify(item)));
    return;
  }
  const normalized = normalize(value);
  if (normalized === undefined) delete data[key];
  else data[key] = normalized;
}

function docIdFromRef(value: unknown): string {
  if (value && typeof value === "object" && "id" in value && typeof (value as { id: unknown }).id === "string") {
    return (value as { id: string }).id;
  }
  return String(value);
}

function autoId(): string {
  return randomBytes(15).toString("base64url");
}

function fieldSegments(field: string): string[] {
  const segments = field.split(".");
  if (segments.length === 0 || segments.some((segment) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(segment))) {
    throw new Error(`Invalid field name ${field}`);
  }
  return segments;
}

function jsonbText(field: string): string {
  const segments = fieldSegments(field);
  if (segments.length === 1) return `data->>'${segments[0]}'`;
  return `data #>> '{${segments.join(",")}}'`;
}

function jsonbValue(field: string): string {
  const segments = fieldSegments(field);
  if (segments.length === 1) return `data->'${segments[0]}'`;
  return `data #> '{${segments.join(",")}}'`;
}

function nest(segments: string[], value: Json): Json {
  let current = value;
  for (let i = segments.length - 1; i >= 0; i--) {
    current = { [segments[i]]: current };
  }
  return current;
}

function primitiveText(value: Json): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function isRetryable(error: unknown): boolean {
  const code = (error as { code?: string }).code;
  return code === "40P01" || code === "40001";
}

// `set({ merge: true })` is the production path for arrayUnion, delete, and increment.
// Those need the current JSON. A shallow `||` would drop the delete or replace the array.
function needsReadModify(value: unknown): boolean {
  if (value == null || typeof value !== "object") return false;
  if (isDelete(value) || incrementOf(value) != null) return true;
  if (arrayElements(value, "ArrayUnionTransform") || arrayElements(value, "ArrayRemoveTransform")) {
    return true;
  }
  if (isServerTimestamp(value) || value instanceof Date || isTimestamp(value)) return false;
  if (Array.isArray(value)) return value.some((entry) => needsReadModify(entry));
  return Object.values(value as Record<string, unknown>).some((entry) => needsReadModify(entry));
}

class Snapshot {
  readonly updateTime: ReturnType<typeof reviveTime> | undefined;

  constructor(
    readonly id: string,
    private readonly row: Record<string, unknown> | undefined,
    readonly ref: DocRef,
    updatedAt?: string,
  ) {
    this.updateTime = updatedAt ? reviveTime(updatedAt) : undefined;
  }

  get exists(): boolean {
    return this.row !== undefined;
  }

  data(): Record<string, unknown> | undefined {
    if (!this.row) return undefined;
    return hydrate(this.row) as Record<string, unknown>;
  }

  stored(): Record<string, unknown> {
    return this.row ? { ...this.row } : {};
  }
}

class DocRef {
  constructor(
    private readonly db: PgDb,
    readonly collectionName: string,
    readonly id: string,
  ) {}

  get path(): string {
    return `${this.collectionName}/${this.id}`;
  }

  async get(): Promise<Snapshot> {
    return this.db.read(this);
  }

  async set(data: Record<string, unknown>, options?: { merge?: boolean }): Promise<void> {
    await this.db.write(this, data, options?.merge === true);
  }

  async create(data: Record<string, unknown>): Promise<void> {
    await this.db.create(this, data);
  }

  async update(patch: Record<string, unknown>): Promise<void> {
    await this.db.patch(this, patch);
  }

  async delete(): Promise<void> {
    await this.db.remove(this);
  }
}

export type QueryResult = {
  docs: Snapshot[];
  size: number;
  empty: boolean;
};

class Query {
  filters: Filter[] = [];
  order: Order | null = null;
  limitN: number | null = null;
  cursor: Cursor | null = null;

  constructor(
    private readonly db: PgDb,
    readonly collectionName: string,
  ) {}

  where(field: { segments?: string[] } | string, op: string, value: unknown): Query {
    const next = this.clone();
    if (typeof field === "object" && field.segments?.[0] === "__name__") {
      const id = docIdFromRef(value);
      if (op === ">=") next.filters.push({ op: "idGte", value: id });
      else if (op === "<") next.filters.push({ op: "idLt", value: id });
      else throw new Error(`Unsupported document id operator ${op}`);
      return next;
    }
    const name = typeof field === "string" ? field : String(field);
    if (op === "==") next.filters.push({ op: "eq", field: name, value });
    else if (op === "in") next.filters.push({ op: "in", field: name, value: value as unknown[] });
    else if (op === ">=" || op === "<=" || op === ">" || op === "<") {
      next.filters.push({ op: "cmp", field: name, cmp: op, value });
    } else if (op === "array-contains-any") {
      next.filters.push({ op: "containsAny", field: name, value: value as unknown[] });
    } else throw new Error(`Unsupported where operator ${op}`);
    return next;
  }

  orderBy(field: string, dir: "asc" | "desc" = "asc"): Query {
    const next = this.clone();
    next.order = { field, dir };
    return next;
  }

  limit(count: number): Query {
    const next = this.clone();
    next.limitN = count;
    return next;
  }

  // Field masks are unused: the only caller reads document ids.
  select(..._fields: string[]): Query {
    return this.clone();
  }

  startAfter(snapshot: Snapshot): Query {
    const next = this.clone();
    next.cursor = { id: snapshot.id, data: snapshot.stored() };
    return next;
  }

  async get(): Promise<QueryResult> {
    const docs = await this.db.queryDocs(this);
    return { docs, size: docs.length, empty: docs.length === 0 };
  }

  count(): { get: () => Promise<{ data: () => { count: number } }> } {
    return {
      get: async () => {
        const count = await this.db.queryCount(this);
        return { data: () => ({ count }) };
      },
    };
  }

  aggregate(spec: Record<string, { _field?: string }>): {
    get: () => Promise<{ data: () => Record<string, number> }>;
  } {
    return {
      get: async () => {
        const data: Record<string, number> = {};
        for (const [alias, field] of Object.entries(spec)) {
          if (!field._field) throw new Error(`Aggregate ${alias} is missing a field`);
          data[alias] = await this.db.querySum(this, field._field);
        }
        return { data: () => data };
      },
    };
  }

  private clone(): Query {
    const next = new Query(this.db, this.collectionName);
    next.filters = [...this.filters];
    next.order = this.order;
    next.limitN = this.limitN;
    next.cursor = this.cursor;
    return next;
  }
}

class Batch {
  private ops: BatchOp[] = [];

  constructor(private readonly db: PgDb) {}

  set(ref: DocRef, data: Record<string, unknown>, options?: { merge?: boolean }): void {
    this.ops.push({ kind: "set", ref, data, merge: options?.merge === true });
  }

  update(ref: DocRef, data: Record<string, unknown>): void {
    this.ops.push({ kind: "update", ref, data });
  }

  delete(ref: DocRef): void {
    this.ops.push({ kind: "delete", ref });
  }

  async commit(): Promise<void> {
    await this.db.commitBatch(this.ops);
  }
}

type BulkItem = {
  kind: "set" | "update" | "delete" | "create";
  ref: DocRef;
  data?: Record<string, unknown>;
  merge?: boolean;
  precondition?: { lastUpdateTime?: { toMillis?: () => number } };
  resolve: () => void;
  reject: (error: unknown) => void;
};

// Firestore BulkWriter, buffered until close(). Each op settles on its own
// promise. A stale lastUpdateTime skips that write (gRPC code 9) and leaves
// the rest of the batch intact. close() rejects on any other failure.
class BulkWriter {
  private ops: BulkItem[] = [];
  private closed = false;
  private closing: Promise<void> | null = null;

  constructor(private readonly db: PgDb) {}

  set(ref: DocRef, data: Record<string, unknown>, options?: { merge?: boolean }): Promise<void> {
    return this.enqueue({ kind: "set", ref, data, merge: options?.merge === true });
  }

  update(
    ref: DocRef,
    data: Record<string, unknown>,
    precondition?: { lastUpdateTime?: { toMillis?: () => number } },
  ): Promise<void> {
    return this.enqueue({ kind: "update", ref, data, precondition });
  }

  delete(ref: DocRef): Promise<void> {
    return this.enqueue({ kind: "delete", ref });
  }

  create(ref: DocRef, data: Record<string, unknown>): Promise<void> {
    return this.enqueue({ kind: "create", ref, data });
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    const ops = this.ops.splice(0);
    this.closing = (async () => {
      try {
        await this.db.commitBulk(ops);
      } catch (error) {
        for (const op of ops) op.reject(error);
        throw error;
      }
    })();
    return this.closing;
  }

  private enqueue(op: Omit<BulkItem, "resolve" | "reject">): Promise<void> {
    if (this.closed) throw new Error("BulkWriter has already been closed.");
    let resolve: () => void = () => undefined;
    let reject: (error: unknown) => void = () => undefined;
    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    // Callers often ignore the per-op promise and only await close().
    promise.catch(() => undefined);
    this.ops.push({ ...op, resolve, reject });
    return promise;
  }
}

// Callers often do not await tx.set/tx.update/tx.delete and then call tx.get.
// Queue writes and flush them before the next read and before commit.
class Transaction {
  private pending: Array<() => Promise<void>> = [];

  constructor(private readonly db: PgDb) {}

  async get(target: DocRef | Query): Promise<Snapshot | QueryResult> {
    await this.flush();
    if (target instanceof Query) {
      const docs = await this.db.queryDocs(target);
      return { docs, size: docs.length, empty: docs.length === 0 };
    }
    return new DocRef(this.db, target.collectionName, target.id).get();
  }

  set(ref: DocRef, data: Record<string, unknown>, options?: { merge?: boolean }): void {
    this.pending.push(() => new DocRef(this.db, ref.collectionName, ref.id).set(data, options));
  }

  update(ref: DocRef, data: Record<string, unknown>): void {
    this.pending.push(() => new DocRef(this.db, ref.collectionName, ref.id).update(data));
  }

  delete(ref: DocRef): void {
    this.pending.push(() => new DocRef(this.db, ref.collectionName, ref.id).delete());
  }

  async flush(): Promise<void> {
    const ops = this.pending.splice(0);
    for (const op of ops) await op();
  }
}

class PgDb {
  constructor(
    private readonly client: SqlClient,
    private readonly inTransaction: boolean,
    private readonly pool: SqlPool | null,
  ) {}

  private async ready(): Promise<void> {
    if (this.inTransaction) return;
    await ensureSchema(this.client);
  }

  collection(name: string): Query & { doc: (id?: string) => DocRef } {
    const query = new Query(this, name);
    return Object.assign(query, {
      doc: (id?: string) => new DocRef(this, name, id ? id : autoId()),
    });
  }

  batch(): Batch {
    return new Batch(this);
  }

  bulkWriter(): BulkWriter {
    return new BulkWriter(this);
  }

  async getAll(...refs: DocRef[]): Promise<Snapshot[]> {
    await this.ready();
    if (refs.length === 0) return [];
    const lock = this.inTransaction ? " FOR UPDATE" : "";
    const result = await this.client.query(
      `SELECT collection, id, data, updated_at
       FROM documents
       WHERE (collection, id) IN (
         SELECT * FROM UNNEST($1::text[], $2::text[])
       )${lock}`,
      [refs.map((ref) => ref.collectionName), refs.map((ref) => ref.id)],
    );
    const found = new Map<string, { data: Record<string, unknown>; updatedAt?: string }>();
    for (const row of result.rows) {
      const data = asRecord(row.data);
      if (data) {
        found.set(`${String(row.collection)}/${String(row.id)}`, {
          data,
          updatedAt: updatedAtIso(row.updated_at),
        });
      }
    }
    return refs.map((ref) => {
      const hit = found.get(`${ref.collectionName}/${ref.id}`);
      return new Snapshot(ref.id, hit?.data, ref, hit?.updatedAt);
    });
  }

  async runTransaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    if (!this.pool) throw new Error("Nested transactions are not supported");
    await this.ready();
    let lastError: unknown;
    for (let attempt = 0; attempt < 5; attempt++) {
      const client = await this.pool.connect();
      const tx = new Transaction(new PgDb(client, true, null));
      try {
        await client.query("BEGIN");
        const result = await fn(tx);
        await tx.flush();
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        lastError = error;
        if (!isRetryable(error) || attempt === 4) throw error;
      } finally {
        client.release();
      }
    }
    throw lastError;
  }

  async read(ref: DocRef): Promise<Snapshot> {
    await this.ready();
    const lock = this.inTransaction ? " FOR UPDATE" : "";
    const result = await this.client.query(
      `SELECT data, updated_at FROM documents WHERE collection = $1 AND id = $2${lock}`,
      [ref.collectionName, ref.id],
    );
    const row = result.rows[0];
    return new Snapshot(ref.id, asRecord(row?.data), ref, updatedAtIso(row?.updated_at));
  }

  async write(ref: DocRef, data: Record<string, unknown>, merge: boolean): Promise<void> {
    await this.ready();
    if (merge && needsReadModify(data)) {
      if (this.inTransaction) {
        await this.applyMerge(ref, data);
        return;
      }
      if (!this.pool) throw new Error("No connection pool for merge");
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        await new PgDb(client, true, null).applyMerge(ref, data);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      return;
    }
    const json = JSON.stringify(normalize(data) ?? {});
    if (merge) {
      await this.client.query(
        `INSERT INTO documents (collection, id, data, updated_at)
         VALUES ($1, $2, $3::jsonb, clock_timestamp())
         ON CONFLICT (collection, id)
         DO UPDATE SET data = documents.data || EXCLUDED.data, updated_at = EXCLUDED.updated_at`,
        [ref.collectionName, ref.id, json],
      );
      return;
    }
    await this.client.query(
      `INSERT INTO documents (collection, id, data, updated_at)
       VALUES ($1, $2, $3::jsonb, clock_timestamp())
       ON CONFLICT (collection, id)
       DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`,
      [ref.collectionName, ref.id, json],
    );
  }

  async create(ref: DocRef, data: Record<string, unknown>): Promise<void> {
    await this.ready();
    const json = JSON.stringify(normalize(data) ?? {});
    const result = await this.client.query(
      `INSERT INTO documents (collection, id, data, updated_at)
       VALUES ($1, $2, $3::jsonb, clock_timestamp())
       ON CONFLICT (collection, id) DO NOTHING`,
      [ref.collectionName, ref.id, json],
    );
    if ((result.rowCount ?? 0) === 0) {
      const error = new Error(`Document already exists: ${ref.path}`) as Error & { code: string };
      error.code = "already-exists";
      throw error;
    }
  }

  async patch(ref: DocRef, patch: Record<string, unknown>): Promise<void> {
    await this.ready();
    if (this.inTransaction) {
      await this.applyPatch(ref, patch);
      return;
    }
    if (!this.pool) throw new Error("No connection pool for update");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await new PgDb(client, true, null).applyPatch(ref, patch);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async applyMerge(ref: DocRef, patch: Record<string, unknown>): Promise<void> {
    const result = await this.client.query(
      "SELECT data FROM documents WHERE collection = $1 AND id = $2 FOR UPDATE",
      [ref.collectionName, ref.id],
    );
    const data = { ...(asRecord(result.rows[0]?.data) ?? {}) };
    for (const [key, value] of Object.entries(patch)) {
      if (needsReadModify(value) || isDelete(value) || incrementOf(value) != null) {
        applySentinel(data, key, value);
      } else {
        const normalized = normalize(value);
        if (normalized === undefined) delete data[key];
        else data[key] = normalized;
      }
    }
    const json = JSON.stringify(data);
    await this.client.query(
      `INSERT INTO documents (collection, id, data, updated_at)
       VALUES ($1, $2, $3::jsonb, clock_timestamp())
       ON CONFLICT (collection, id)
       DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`,
      [ref.collectionName, ref.id, json],
    );
  }

  private async applyPatch(ref: DocRef, patch: Record<string, unknown>): Promise<void> {
    const result = await this.client.query(
      "SELECT data FROM documents WHERE collection = $1 AND id = $2 FOR UPDATE",
      [ref.collectionName, ref.id],
    );
    const row = asRecord(result.rows[0]?.data);
    if (!row) throw new Error(`No document to update: ${ref.path}`);
    const data = { ...row };
    for (const [key, value] of Object.entries(patch)) applySentinel(data, key, value);
    await this.client.query(
      "UPDATE documents SET data = $3::jsonb, updated_at = clock_timestamp() WHERE collection = $1 AND id = $2",
      [ref.collectionName, ref.id, JSON.stringify(data)],
    );
  }

  async remove(ref: DocRef): Promise<void> {
    await this.ready();
    await this.client.query("DELETE FROM documents WHERE collection = $1 AND id = $2", [
      ref.collectionName,
      ref.id,
    ]);
  }

  async queryDocs(query: Query, lock = this.inTransaction): Promise<Snapshot[]> {
    await this.ready();
    const { sql, params } = compile(query, "id, data, updated_at", { lock });
    const result = await this.client.query(sql, params);
    return result.rows.map((row) => {
      const id = String(row.id);
      return new Snapshot(
        id,
        asRecord(row.data),
        new DocRef(this, query.collectionName, id),
        updatedAtIso(row.updated_at),
      );
    });
  }

  async queryCount(query: Query): Promise<number> {
    await this.ready();
    const { sql, params } = compile(query, "count(*)::int AS count", { count: true });
    const result = await this.client.query(sql, params);
    return Number(result.rows[0]?.count ?? 0);
  }

  async querySum(query: Query, field: string): Promise<number> {
    await this.ready();
    const { sql, params } = compile(query, "0 AS total", { sumField: field });
    const result = await this.client.query(sql, params);
    return Number(result.rows[0]?.total ?? 0);
  }

  async commitBatch(ops: BatchOp[]): Promise<void> {
    await this.ready();
    if (this.inTransaction) {
      await this.applyBatch(ops);
      return;
    }
    if (!this.pool) throw new Error("No connection pool for batch");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await new PgDb(client, true, null).applyBatch(ops);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async applyBatch(ops: BatchOp[]): Promise<void> {
    for (const op of ops) {
      const ref = new DocRef(this, op.ref.collectionName, op.ref.id);
      if (op.kind === "delete") await this.remove(ref);
      else if (op.kind === "update") await this.patch(ref, op.data);
      else await this.write(ref, op.data, op.merge);
    }
  }

  async commitBulk(ops: BulkItem[]): Promise<void> {
    await this.ready();
    const run = async (db: PgDb) => {
      const ok: BulkItem[] = [];
      const skipped: Array<{ op: BulkItem; error: unknown }> = [];
      for (const op of ops) {
        try {
          await db.applyBulkOp(op);
          ok.push(op);
        } catch (error) {
          // FAILED_PRECONDITION: this write is stale. Keep the other ops.
          if ((error as { code?: number }).code === 9) {
            skipped.push({ op, error });
            continue;
          }
          throw error;
        }
      }
      return { ok, skipped };
    };
    const settle = (result: { ok: BulkItem[]; skipped: Array<{ op: BulkItem; error: unknown }> }) => {
      for (const op of result.ok) op.resolve();
      for (const item of result.skipped) item.op.reject(item.error);
    };

    if (this.inTransaction) {
      settle(await run(this));
      return;
    }
    if (!this.pool) throw new Error("No connection pool for bulk writer");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await run(new PgDb(client, true, null));
      await client.query("COMMIT");
      settle(result);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async applyBulkOp(op: BulkItem): Promise<void> {
    const ref = new DocRef(this, op.ref.collectionName, op.ref.id);
    if (op.kind === "delete") {
      await this.remove(ref);
      return;
    }
    if (op.kind === "create") {
      await this.create(ref, op.data ?? {});
      return;
    }
    if (op.kind === "set") {
      await this.write(ref, op.data ?? {}, op.merge === true);
      return;
    }
    const expected = op.precondition?.lastUpdateTime;
    if (expected && typeof expected.toMillis === "function") {
      const current = await this.currentUpdateMillis(ref);
      if (current == null || current !== expected.toMillis()) {
        const error = new Error(`Document ${ref.path} changed since it was read`) as Error & {
          code: number;
        };
        error.code = 9;
        throw error;
      }
    }
    await this.patch(ref, op.data ?? {});
  }

  private async currentUpdateMillis(ref: DocRef): Promise<number | null> {
    const result = await this.client.query(
      "SELECT updated_at FROM documents WHERE collection = $1 AND id = $2 FOR UPDATE",
      [ref.collectionName, ref.id],
    );
    const iso = updatedAtIso(result.rows[0]?.updated_at);
    return iso ? new Date(iso).getTime() : null;
  }
}

function orderField(field: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(field)) throw new Error(`Invalid field name ${field}`);
  return field;
}

function compile(
  query: Query,
  select: string,
  options?: { count?: boolean; sumField?: string; lock?: boolean },
): { sql: string; params: unknown[] } {
  const params: unknown[] = [query.collectionName];
  const where = ["collection = $1"];

  if (options?.sumField) {
    params.push(options.sumField);
    select = `COALESCE(SUM((data->>$${params.length})::double precision), 0) AS total`;
  }

  for (const filter of query.filters) {
    if (filter.op === "eq") {
      const norm = normalize(filter.value) ?? null;
      if (norm !== null && typeof norm === "object") {
        params.push(JSON.stringify(nest(fieldSegments(filter.field), norm)));
        where.push(`data @> $${params.length}::jsonb`);
      } else if (norm === null) {
        where.push(`(${jsonbValue(filter.field)}) = 'null'::jsonb`);
      } else {
        params.push(primitiveText(norm));
        where.push(`${jsonbText(filter.field)} = $${params.length}`);
      }
    } else if (filter.op === "in") {
      if (filter.value.length === 0) {
        where.push("FALSE");
        continue;
      }
      params.push(filter.value.map((value) => primitiveText(normalize(value) ?? null)));
      where.push(`${jsonbText(filter.field)} = ANY($${params.length}::text[])`);
    } else if (filter.op === "cmp") {
      const norm = normalize(filter.value) ?? null;
      if (typeof norm === "number") {
        params.push(norm);
        where.push(`(${jsonbText(filter.field)})::double precision ${filter.cmp} $${params.length}`);
      } else {
        params.push(norm == null ? "" : String(norm));
        where.push(`${jsonbText(filter.field)} ${filter.cmp} $${params.length}`);
      }
    } else if (filter.op === "containsAny") {
      if (filter.value.length === 0) {
        where.push("FALSE");
        continue;
      }
      params.push(filter.value.map((value) => primitiveText(normalize(value) ?? null)));
      where.push(`(${jsonbValue(filter.field)}) ?| $${params.length}::text[]`);
    } else if (filter.op === "idGte") {
      params.push(filter.value);
      where.push(`id >= $${params.length}`);
    } else if (filter.op === "idLt") {
      params.push(filter.value);
      where.push(`id < $${params.length}`);
    }
  }

  if (query.cursor && query.order) {
    const current = query.cursor.data[query.order.field];
    params.push(current == null ? "" : String(normalize(current) ?? ""));
    params.push(query.cursor.id);
    const valueParam = params.length - 1;
    const idParam = params.length;
    const cmp = query.order.dir === "desc" ? "<" : ">";
    const field = orderField(query.order.field);
    where.push(
      `(data->>'${field}' ${cmp} $${valueParam} OR (data->>'${field}' = $${valueParam} AND id ${cmp} $${idParam}))`,
    );
  }

  let sql = `SELECT ${select} FROM documents WHERE ${where.join(" AND ")}`;
  if (!options?.count && !options?.sumField && query.order) {
    const field = orderField(query.order.field);
    const dir = query.order.dir === "desc" ? "DESC" : "ASC";
    sql += ` ORDER BY data->>'${field}' ${dir}, id ${dir}`;
  }
  if (!options?.count && !options?.sumField && query.limitN != null) {
    params.push(query.limitN);
    sql += ` LIMIT $${params.length}`;
  }
  if (options?.lock) sql += " FOR UPDATE";
  return { sql, params };
}

export function createPostgresDocumentStore(pool: SqlPool): PgDb {
  return new PgDb(pool, false, pool);
}

export function getPostgresDb(): PgDb {
  if (!globalStore.lagerPgDb) globalStore.lagerPgDb = createPostgresDocumentStore(pool());
  return globalStore.lagerPgDb;
}
