"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { OrderInternalStatus } from "@/server/firestore/schema";

export type OrderLineItemBundleRef = {
  groupId: string;
  title: string;
  quantity: number;
  variantSku: string | null;
};

export type OrderLineItemRow = {
  id: string;
  title: string;
  variantTitle: string;
  sku: string | null;
  qty: number;
  imageUrl: string | null;
  imageMissingReason: "no_variant" | "no_product" | "no_image" | null;
  variantId: string;
  onHand: number;
  reserved: number;
  available: number;
  /** Original Shopify line-item ids that were folded into this row. */
  mergedFromIds: string[];
  bundle: OrderLineItemBundleRef | null;
};

export type OrderRow = {
  id: string;
  name: string;
  status: OrderInternalStatus;
  tags: string[];
  stopReason: string | null;
  createdIso: string;
  itemCount: number;
  lineItems: OrderLineItemRow[];
};

const STATUS_BADGE: Record<OrderInternalStatus, string> = {
  NEW: "bg-zinc-100 text-zinc-700",
  SHIP: "bg-emerald-100 text-emerald-800",
  PICKING: "bg-violet-100 text-violet-800",
  STOP: "bg-amber-100 text-amber-800",
  PACKED: "bg-sky-100 text-sky-800",
  CANCELLED: "bg-zinc-200 text-zinc-600",
};

export function OrdersTable({ orders }: { orders: OrderRow[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (orders.length === 0) {
    return (
      <p className="px-6 py-8 text-sm text-zinc-500">Keine Bestellungen.</p>
    );
  }

  return (
    <table className="w-full divide-y divide-zinc-200 text-sm">
      <thead className="bg-zinc-50 text-left">
        <tr>
          <th className="w-10 px-2 py-2"></th>
          <th className="px-4 py-2 font-medium">Order</th>
          <th className="px-4 py-2 font-medium">Erstellt</th>
          <th className="px-4 py-2 font-medium">Status</th>
          <th className="px-4 py-2 font-medium">Items</th>
          <th className="px-4 py-2 font-medium">Tags</th>
          <th className="px-4 py-2 font-medium">Stop-Grund</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-zinc-100">
        {orders.map((o) => {
          const isOpen = expanded.has(o.id);
          return (
            <Row
              key={o.id}
              order={o}
              isOpen={isOpen}
              onToggle={() => toggle(o.id)}
            />
          );
        })}
      </tbody>
    </table>
  );
}

function Row({
  order,
  isOpen,
  onToggle,
}: {
  order: OrderRow;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className={isOpen ? "bg-zinc-50/60" : undefined}>
        <td className="px-2 py-2">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={isOpen}
            aria-label={isOpen ? "Zuklappen" : "Aufklappen"}
            className="flex h-7 w-7 items-center justify-center rounded text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900"
          >
            <svg
              viewBox="0 0 20 20"
              fill="currentColor"
              className={`h-4 w-4 transition-transform ${
                isOpen ? "rotate-90" : ""
              }`}
            >
              <path
                fillRule="evenodd"
                d="M7.21 5.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 1 1-1.06-1.06L10.94 10 7.21 6.28a.75.75 0 0 1 0-1.06Z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </td>
        <td className="px-4 py-2 font-mono">
          <Link
            href={`/admin/orders/${order.id}`}
            className="hover:underline"
          >
            {order.name}
          </Link>
        </td>
        <td className="px-4 py-2 text-zinc-500">
          {order.createdIso
            ? new Date(order.createdIso).toLocaleString("de-DE")
            : "—"}
        </td>
        <td className="px-4 py-2">
          <span
            className={`inline-flex rounded px-2 py-0.5 text-xs font-semibold ${
              STATUS_BADGE[order.status]
            }`}
          >
            {order.status}
          </span>
        </td>
        <td className="px-4 py-2">
          {order.itemCount} ({order.lineItems.length} LineItems)
        </td>
        <td className="px-4 py-2">
          <div className="flex flex-wrap gap-1">
            {order.tags.map((t) => (
              <span
                key={t}
                className={`rounded px-1.5 py-0.5 text-xs ${
                  t === "EXPRESS_DHL"
                    ? "bg-purple-100 text-purple-800"
                    : "bg-zinc-100 text-zinc-700"
                }`}
              >
                {t}
              </span>
            ))}
          </div>
        </td>
        <td className="px-4 py-2 text-xs text-zinc-500">
          {order.stopReason ?? ""}
        </td>
      </tr>
      {isOpen ? (
        <tr className="bg-zinc-50/60">
          <td colSpan={7} className="px-4 pb-4 pt-0">
            <LineItems items={order.lineItems} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

type LineItemGroup =
  | { kind: "single"; item: OrderLineItemRow }
  | {
      kind: "bundle";
      ref: OrderLineItemBundleRef;
      items: OrderLineItemRow[];
    };

function groupLineItemsByBundle(items: OrderLineItemRow[]): LineItemGroup[] {
  const groups: LineItemGroup[] = [];
  const indexByGroupId = new Map<string, number>();
  for (const li of items) {
    if (li.bundle) {
      const idx = indexByGroupId.get(li.bundle.groupId);
      if (idx !== undefined) {
        const existing = groups[idx];
        if (existing && existing.kind === "bundle") existing.items.push(li);
      } else {
        indexByGroupId.set(li.bundle.groupId, groups.length);
        groups.push({ kind: "bundle", ref: li.bundle, items: [li] });
      }
    } else {
      groups.push({ kind: "single", item: li });
    }
  }
  return groups;
}

function LineItems({ items }: { items: OrderLineItemRow[] }) {
  if (items.length === 0) {
    return (
      <p className="px-2 py-3 text-xs text-zinc-500">Keine Line Items.</p>
    );
  }
  const groups = groupLineItemsByBundle(items);
  return (
    <div className="overflow-hidden rounded-md border border-zinc-200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
          <tr>
            <th className="w-16 px-3 py-2 font-medium">Bild</th>
            <th className="px-3 py-2 font-medium">Produkt</th>
            <th className="px-3 py-2 font-medium">SKU</th>
            <th className="px-3 py-2 font-medium text-right">Bestellt</th>
            <th className="px-3 py-2 font-medium text-right">Bestand</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {groups.map((g) =>
            g.kind === "single" ? (
              <ItemRow key={g.item.id} item={g.item} component={false} />
            ) : (
              <BundleSection
                key={g.ref.groupId}
                bundle={g.ref}
                items={g.items}
              />
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}

function BundleSection({
  bundle,
  items,
}: {
  bundle: OrderLineItemBundleRef;
  items: OrderLineItemRow[];
}) {
  return (
    <>
      <tr className="bg-indigo-50/60">
        <td colSpan={5} className="px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-indigo-600 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
              Bundle
            </span>
            <span className="font-semibold text-indigo-900">
              {bundle.title}
            </span>
            {bundle.variantSku ? (
              <span className="font-mono text-xs text-indigo-700/70">
                {bundle.variantSku}
              </span>
            ) : null}
            <span className="ml-auto text-xs text-indigo-900">
              ×{" "}
              <span className="font-mono font-semibold tabular-nums">
                {bundle.quantity}
              </span>{" "}
              Bundle{bundle.quantity === 1 ? "" : "s"} · {items.length}{" "}
              Komponente{items.length === 1 ? "" : "n"}
            </span>
          </div>
        </td>
      </tr>
      {items.map((li) => (
        <ItemRow key={li.id} item={li} component={true} />
      ))}
    </>
  );
}

function ItemRow({
  item: li,
  component,
}: {
  item: OrderLineItemRow;
  component: boolean;
}) {
  const shortfall = li.available < li.qty;
  return (
    <tr className={component ? "bg-indigo-50/20" : undefined}>
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          {component ? (
            <span
              aria-hidden
              className="ml-1 inline-block h-8 w-3 border-l-2 border-b-2 border-indigo-300"
            />
          ) : null}
          <div
            className="h-12 w-12 overflow-hidden rounded border border-zinc-200 bg-zinc-50"
            title={
              li.imageMissingReason === "no_variant"
                ? "Variant nicht in Firestore — Produkt-Sync ausführen"
                : li.imageMissingReason === "no_product"
                  ? "Produkt nicht in Firestore — Produkt-Sync ausführen"
                  : li.imageMissingReason === "no_image"
                    ? "Produkt hat in Shopify kein featuredMedia"
                    : undefined
            }
          >
            {li.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={li.imageUrl}
                alt=""
                className="h-full w-full object-cover"
                loading="lazy"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-center text-[9px] leading-tight text-zinc-400">
                {li.imageMissingReason === "no_variant"
                  ? "Variant fehlt"
                  : li.imageMissingReason === "no_product"
                    ? "Produkt fehlt"
                    : "kein Bild"}
              </div>
            )}
          </div>
        </div>
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-1.5 font-medium">
          {li.title}
          {li.mergedFromIds.length > 1 ? (
            <span
              className="rounded bg-zinc-200 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-700"
              title={`Aus ${li.mergedFromIds.length} Positionen zusammengeführt: ${li.mergedFromIds.join(", ")}`}
            >
              ×{li.mergedFromIds.length}
            </span>
          ) : null}
        </div>
        {li.variantTitle && li.variantTitle !== "Default Title" ? (
          <div className="text-xs text-zinc-500">{li.variantTitle}</div>
        ) : null}
      </td>
      <td className="px-3 py-2 font-mono text-xs">{li.sku ?? "—"}</td>
      <td className="px-3 py-2 text-right text-base font-semibold tabular-nums">
        {li.qty}
      </td>
      <td className="px-3 py-2 text-right">
        <StockBadge
          onHand={li.onHand}
          reserved={li.reserved}
          available={li.available}
          shortfall={shortfall}
        />
      </td>
    </tr>
  );
}

function StockBadge({
  onHand,
  reserved,
  available,
  shortfall,
}: {
  onHand: number;
  reserved: number;
  available: number;
  shortfall: boolean;
}) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // SSR-hydration flip — running this synchronously is intentional.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  const TOOLTIP_WIDTH = 176;
  const updatePos = () => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      top: r.bottom + 6,
      left: Math.max(8, r.right - TOOLTIP_WIDTH),
    });
  };

  const show = () => {
    updatePos();
    setOpen(true);
  };
  const hide = () => setOpen(false);

  const color = shortfall
    ? "bg-amber-100 text-amber-800 ring-amber-200"
    : "bg-emerald-100 text-emerald-800 ring-emerald-200";

  return (
    <>
      <span
        ref={triggerRef}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        tabIndex={0}
        className={`inline-flex cursor-default items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset tabular-nums outline-none ${color}`}
      >
        {available}
        <svg
          viewBox="0 0 20 20"
          fill="currentColor"
          className="h-3 w-3 opacity-60"
          aria-hidden
        >
          <path d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm.75 4.5a.75.75 0 0 0-1.5 0v4.5a.75.75 0 0 0 .22.53l3 3a.75.75 0 1 0 1.06-1.06l-2.78-2.78V6.5Z" />
        </svg>
      </span>
      {mounted && open && pos
        ? createPortal(
            <div
              role="tooltip"
              style={{
                position: "fixed",
                top: pos.top,
                left: pos.left,
                width: TOOLTIP_WIDTH,
              }}
              className="pointer-events-none z-50 rounded-md bg-zinc-900 px-3 py-2 text-left text-xs text-white shadow-lg"
            >
              <div className="flex justify-between gap-3 tabular-nums">
                <span className="text-zinc-400">Auf Lager</span>
                <span className="font-mono">{onHand}</span>
              </div>
              <div className="flex justify-between gap-3 tabular-nums">
                <span className="text-zinc-400">Reserviert</span>
                <span className="font-mono">{reserved}</span>
              </div>
              <div className="mt-1 flex justify-between gap-3 border-t border-zinc-700 pt-1 tabular-nums">
                <span className="text-zinc-400">Verfügbar</span>
                <span className="font-mono font-semibold">{available}</span>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
