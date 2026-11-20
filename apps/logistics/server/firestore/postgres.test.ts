import { PGlite } from "@electric-sql/pglite";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createPostgresDocumentStore,
  type SqlPool,
} from "./postgres";

const postgres = new PGlite();

function wrap(db: PGlite): SqlPool {
  const query = async (text: string, values?: unknown[]) => {
    const result = await db.query(text, values);
    return {
      rows: result.rows as Record<string, unknown>[],
      rowCount: result.affectedRows ?? null,
    };
  };
  const client = { query, release() {} };
  return {
    query,
    async connect() {
      return client;
    },
  };
}

const db = createPostgresDocumentStore(wrap(postgres));

beforeAll(async () => {
  await db.collection("orders").doc("warmup").set({ ok: true });
});

beforeEach(async () => {
  await postgres.query("DELETE FROM documents");
});

afterAll(async () => {
  await postgres.close();
});

describe("postgres document store", () => {
  it("stores serverTimestamp and revives it as a date", async () => {
    await db.collection("orders").doc("o1").set({
      name: "1001",
      created_at: FieldValue.serverTimestamp(),
    });
    const data = (await db.collection("orders").doc("o1").get()).data();
    expect(data?.name).toBe("1001");
    const created = data?.created_at as { toDate: () => Date; seconds: number };
    expect(typeof created.toDate).toBe("function");
    expect(Math.abs(Date.now() - created.toDate().getTime())).toBeLessThan(5_000);
    expect(created.seconds).toBe(Math.floor(created.toDate().getTime() / 1000));
  });

  it("removes a field on delete and unions arrays", async () => {
    await db.collection("users").doc("u1").set({
      shop_ids: ["a"],
      pending_shop_domain: "old.myshopify.com",
    });
    await db.collection("users").doc("u1").update({
      shop_ids: FieldValue.arrayUnion("b", "a"),
      pending_shop_domain: FieldValue.delete(),
    });
    expect((await db.collection("users").doc("u1").get()).data()).toEqual({
      shop_ids: ["a", "b"],
    });
  });

  it("applies arrayUnion and delete through a merge set", async () => {
    await db.collection("users").doc("u1").set({
      shop_ids: ["a"],
      pending_shop_domain: "old.myshopify.com",
      name: "Ada",
    });
    await db.collection("users").doc("u1").set(
      {
        shop_ids: FieldValue.arrayUnion("b"),
        pending_shop_domain: FieldValue.delete(),
      },
      { merge: true },
    );
    expect((await db.collection("users").doc("u1").get()).data()).toEqual({
      shop_ids: ["a", "b"],
      name: "Ada",
    });
  });

  it("filters ranges and array-contains-any", async () => {
    await db.collection("shopify_outbox").doc("due").set({
      next_retry_at: "2020-01-01T00:00:00.000Z",
    });
    await db.collection("shopify_outbox").doc("later").set({
      next_retry_at: "2099-01-01T00:00:00.000Z",
    });
    const due = await db
      .collection("shopify_outbox")
      .where("next_retry_at", "<=", Timestamp.fromDate(new Date("2024-01-01T00:00:00.000Z")))
      .get();
    expect(due.docs.map((doc) => doc.id)).toEqual(["due"]);

    await db.collection("orders").doc("old").set({
      created_at_shopify: "2020-01-01T00:00:00.000Z",
    });
    await db.collection("orders").doc("fresh").set({
      created_at_shopify: "2026-06-01T00:00:00.000Z",
    });
    const recent = await db
      .collection("orders")
      .where("created_at_shopify", ">=", "2026-01-01T00:00:00.000Z")
      .orderBy("created_at_shopify", "desc")
      .get();
    expect(recent.docs.map((doc) => doc.id)).toEqual(["fresh"]);

    await db.collection("users").doc("u1").set({ shop_ids: ["shop-a"] });
    await db.collection("users").doc("u2").set({ shop_ids: ["shop-b"] });
    const matched = await db
      .collection("users")
      .where("shop_ids", "array-contains-any", ["shop-b", "shop-c"])
      .get();
    expect(matched.docs.map((doc) => doc.id)).toEqual(["u2"]);
  });

  it("sees a query inside the same transaction and locks the read", async () => {
    const found = await db.runTransaction(async (tx) => {
      tx.set(db.collection("allocations").doc("a1"), { order_id: "o1", qty: 2 });
      const snap = await tx.get(
        db.collection("allocations").where("order_id", "==", "o1"),
      );
      return snap.docs.map((doc) => doc.data());
    });
    expect(found).toEqual([{ order_id: "o1", qty: 2 }]);
    expect((await db.collection("allocations").doc("a1").get()).exists).toBe(true);
  });

  it("updates through a batch", async () => {
    await db.collection("variants").doc("v1").set({ on_hand: 5, note: "keep-me-not" });
    const batch = db.batch();
    batch.update(db.collection("variants").doc("v1"), {
      on_hand: FieldValue.increment(2),
      note: FieldValue.delete(),
    });
    await batch.commit();
    expect((await db.collection("variants").doc("v1").get()).data()).toEqual({
      on_hand: 7,
    });
  });

  it("matches nested fields and rejects a second create", async () => {
    await db.collection("orders").doc("o1").set({
      customer: { email: "a@b.c" },
      ref: { id: "o1" },
    });
    const byEmail = await db.collection("orders").where("customer.email", "==", "a@b.c").get();
    const byRef = await db.collection("orders").where("ref.id", "==", "o1").get();
    expect(byEmail.docs.map((doc) => doc.id)).toEqual(["o1"]);
    expect(byRef.docs.map((doc) => doc.id)).toEqual(["o1"]);

    await db.collection("webhook_events").doc("w1").create({ status: "RECEIVED" });
    await expect(
      db.collection("webhook_events").doc("w1").create({ status: "RECEIVED" }),
    ).rejects.toMatchObject({ code: "already-exists" });

    const ref = db.collection("batches").doc();
    expect(ref.id.length).toBeGreaterThan(0);
    await ref.set({ qty: 1 });
    const ids = await db.collection("batches").select().get();
    expect(ids.docs.map((doc) => doc.id)).toEqual([ref.id]);
  });

  it("creates the shop_id expression index", async () => {
    await db.collection("orders").doc("o1").set({ shop_id: "shop.myshopify.com" });
    const indexes = await postgres.query<{ indexname: string }>(
      "SELECT indexname FROM pg_indexes WHERE tablename = 'documents'",
    );
    expect(indexes.rows.map((row) => row.indexname)).toContain(
      "documents_collection_shop_id",
    );
  });
});
