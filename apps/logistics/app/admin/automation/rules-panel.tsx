"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type {
  AutomationAction,
  AutomationConditionNode,
  AutomationTrigger,
} from "@/server/firestore/schema";
import {
  deleteRuleAction,
  dryRunRuleAction,
  listGiftVariantsAction,
  runRuleAction,
  saveRuleAction,
  toggleRuleAction,
  type GiftVariantOption,
} from "./actions";
import {
  dispatchAdminJobError,
  dispatchAdminJobSuccess,
} from "@/app/admin/_components/admin-jobs-events";
import { MoneyInput } from "@/app/admin/products/money-input";
import { centsToMoneyInput, parseMoneyInputToCents } from "@/lib/money-input";
import { formatVariantLabel, VariantPickerModal } from "./variant-picker-modal";

export type RuleRow = {
  id: string;
  name: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  priority: number;
  stop_on_match: boolean;
  conditions: AutomationConditionNode | null;
  actions: AutomationAction[];
};

const TRIGGERS: AutomationTrigger[] = [
  "ORDER_IMPORTED",
  "ORDER_PAID",
  "ORDER_SHIP",
  "ORDER_STOP",
  "PICKING_STARTED",
  "PACKED",
  "ORDER_CANCELLED",
  "ORDER_REFUNDED",
  "INBOUND",
];

const MONEY_FIELDS = new Set(["customer.ltv_cents", "order.total_price_cents"]);

const CONDITION_FIELDS = [
  { value: "customer.ltv_cents", label: "Kunde LTV (€)" },
  { value: "customer.order_count", label: "Kunde Bestellanzahl" },
  { value: "order.total_price_cents", label: "Order-Wert (€)" },
  { value: "order.effective_tags", label: "Tags (effektiv)" },
  { value: "order.has_priority_tag", label: "Hat Priority-Tag" },
  { value: "order.shipping_country_code", label: "Land (ISO)" },
  { value: "order.skus", label: "SKUs" },
] as const;

type CondDraft = {
  field: string;
  op: "gt" | "gte" | "lt" | "lte" | "eq" | "contains";
  /** Display string — euros for money fields, raw otherwise. */
  value: string;
};

type ActionDraft =
  | {
      type: "add_free_gift";
      variant_id: string;
      variant_label: string;
      qty: string;
    }
  | { type: "add_local_tag"; tag: string }
  | { type: "remove_local_tag"; tag: string }
  | { type: "set_priority_score"; score: string }
  | { type: "hold_order" }
  | { type: "release_hold" };

function isMoneyField(field: string): boolean {
  return MONEY_FIELDS.has(field);
}

const emptyDraft = (): {
  id?: string;
  name: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  priority: string;
  stop_on_match: boolean;
  conditions: CondDraft[];
  actions: ActionDraft[];
} => ({
  name: "",
  enabled: true,
  trigger: "ORDER_IMPORTED",
  priority: "100",
  stop_on_match: false,
  conditions: [{ field: "customer.ltv_cents", op: "gt", value: "500,00" }],
  actions: [
    { type: "add_free_gift", variant_id: "", variant_label: "", qty: "1" },
  ],
});

export function AutomationRulesPanel({
  initialRules,
}: {
  initialRules: RuleRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState(emptyDraft);
  const [editing, setEditing] = useState(false);
  const [dryOrderId, setDryOrderId] = useState("");
  const [dryResult, setDryResult] = useState<string | null>(null);
  const [pickerIndex, setPickerIndex] = useState<number | null>(null);

  function openNew() {
    setDraft(emptyDraft());
    setEditing(true);
    setDryResult(null);
  }

  function openEdit(rule: RuleRow) {
    const actions = rule.actions.map(actionToDraft);
    setDraft({
      id: rule.id,
      name: rule.name,
      enabled: rule.enabled,
      trigger: rule.trigger,
      priority: String(rule.priority),
      stop_on_match: rule.stop_on_match,
      conditions: flattenConditions(rule.conditions),
      actions,
    });
    setEditing(true);
    setDryResult(null);

    const giftIds = actions
      .filter(
        (a): a is Extract<ActionDraft, { type: "add_free_gift" }> =>
          a.type === "add_free_gift" && !!a.variant_id,
      )
      .map((a) => a.variant_id);
    if (giftIds.length === 0) return;

    startTransition(async () => {
      const res = await listGiftVariantsAction();
      if (!res.ok) return;
      const byId = new Map(res.variants.map((v) => [v.variantId, v]));
      setDraft((d) => ({
        ...d,
        actions: d.actions.map((a) => {
          if (a.type !== "add_free_gift" || !a.variant_id) return a;
          const v = byId.get(a.variant_id);
          if (!v) return a;
          return { ...a, variant_label: formatVariantLabel(v) };
        }),
      }));
    });
  }

  function save() {
    startTransition(async () => {
      const conditions = buildConditions(draft.conditions);
      if (conditions === "invalid_money") {
        dispatchAdminJobError({
          title: "Automatismen",
          message: "Ungültiger Geldbetrag — bitte als z.B. 500,00 eingeben.",
        });
        return;
      }
      const payload = {
        id: draft.id,
        name: draft.name.trim(),
        enabled: draft.enabled,
        trigger: draft.trigger,
        priority: Number(draft.priority) || 100,
        stop_on_match: draft.stop_on_match,
        conditions,
        actions: draft.actions
          .map(draftToAction)
          .filter((a): a is AutomationAction => a != null),
      };
      const res = await saveRuleAction(payload);
      if (res.ok) {
        dispatchAdminJobSuccess({
          title: "Automatismen",
          message: draft.id ? "Regel aktualisiert." : "Regel angelegt.",
        });
        setEditing(false);
        router.refresh();
      } else {
        dispatchAdminJobError({
          title: "Automatismen",
          message: res.error,
        });
      }
    });
  }

  const pickerAction =
    pickerIndex != null && draft.actions[pickerIndex]?.type === "add_free_gift"
      ? (draft.actions[pickerIndex] as Extract<
          ActionDraft,
          { type: "add_free_gift" }
        >)
      : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <button type="button" className="btn-primary text-sm" onClick={openNew}>
          Neue Regel
        </button>
      </div>

      <div className="overflow-hidden rounded-md border border-zinc-200">
        <table className="w-full text-left text-sm">
          <thead className="bg-zinc-50 text-[11px] uppercase tracking-wide text-brand-navy/50">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Trigger</th>
              <th className="px-3 py-2">Prio</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {initialRules.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-3 py-8 text-center text-brand-navy/50"
                >
                  Noch keine Regeln.
                </td>
              </tr>
            ) : (
              initialRules.map((r) => (
                <tr key={r.id} className="border-t border-zinc-100">
                  <td className="px-3 py-2 font-medium text-brand-navy">
                    {r.name}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{r.trigger}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.priority}</td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      disabled={pending}
                      className={`text-xs font-semibold ${
                        r.enabled ? "text-emerald-700" : "text-zinc-400"
                      }`}
                      onClick={() =>
                        startTransition(async () => {
                          const res = await toggleRuleAction(r.id, !r.enabled);
                          if (!res.ok) {
                            dispatchAdminJobError({
                              title: "Automatismen",
                              message: res.error,
                            });
                          } else router.refresh();
                        })
                      }
                    >
                      {r.enabled ? "Aktiv" : "Aus"}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      className="text-xs font-semibold text-brand-burgundy"
                      onClick={() => openEdit(r)}
                    >
                      Bearbeiten
                    </button>
                    <button
                      type="button"
                      className="ml-3 text-xs text-zinc-400 hover:text-red-600"
                      disabled={pending}
                      onClick={() =>
                        startTransition(async () => {
                          if (!confirm(`Regel „${r.name}“ löschen?`)) return;
                          const res = await deleteRuleAction(r.id);
                          if (!res.ok) {
                            dispatchAdminJobError({
                              title: "Automatismen",
                              message: res.error,
                            });
                          } else {
                            dispatchAdminJobSuccess({
                              title: "Automatismen",
                              message: "Regel gelöscht.",
                            });
                            router.refresh();
                          }
                        })
                      }
                    >
                      Löschen
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {editing ? (
        <div className="space-y-4 rounded-md border border-zinc-200 bg-zinc-50 p-5">
          <h2 className="text-sm font-semibold text-brand-navy">
            {draft.id ? "Regel bearbeiten" : "Neue Regel"}
          </h2>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name">
              <input
                className="input-sm w-full"
                value={draft.name}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, name: e.target.value }))
                }
              />
            </Field>
            <Field label="Trigger">
              <select
                className="input-sm w-full"
                value={draft.trigger}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    trigger: e.target.value as AutomationTrigger,
                  }))
                }
              >
                {TRIGGERS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Priorität (niedriger = früher)">
              <input
                className="input-sm w-full font-mono"
                type="number"
                value={draft.priority}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, priority: e.target.value }))
                }
              />
            </Field>
            <div className="flex items-end gap-4 pb-1">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, enabled: e.target.checked }))
                  }
                />
                Aktiv
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.stop_on_match}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      stop_on_match: e.target.checked,
                    }))
                  }
                />
                Stop after match
              </label>
            </div>
          </div>

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-brand-navy/60">
                Bedingungen (UND)
              </h3>
              <button
                type="button"
                className="text-xs font-semibold text-brand-burgundy"
                onClick={() =>
                  setDraft((d) => ({
                    ...d,
                    conditions: [
                      ...d.conditions,
                      {
                        field: "customer.ltv_cents",
                        op: "gt",
                        value: "500,00",
                      },
                    ],
                  }))
                }
              >
                + Bedingung
              </button>
            </div>
            {draft.conditions.map((c, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-4">
                <select
                  className="input-sm"
                  value={c.field}
                  onChange={(e) =>
                    setDraft((d) => {
                      const nextField = e.target.value;
                      const next = [...d.conditions];
                      const wasMoney = isMoneyField(c.field);
                      const nowMoney = isMoneyField(nextField);
                      let value = c.value;
                      if (wasMoney && !nowMoney) value = "";
                      if (!wasMoney && nowMoney) value = "0,00";
                      next[i] = { ...c, field: nextField, value };
                      return { ...d, conditions: next };
                    })
                  }
                >
                  {CONDITION_FIELDS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
                <select
                  className="input-sm"
                  value={c.op}
                  onChange={(e) =>
                    setDraft((d) => {
                      const next = [...d.conditions];
                      next[i] = {
                        ...c,
                        op: e.target.value as CondDraft["op"],
                      };
                      return { ...d, conditions: next };
                    })
                  }
                >
                  <option value="gt">&gt;</option>
                  <option value="gte">≥</option>
                  <option value="lt">&lt;</option>
                  <option value="lte">≤</option>
                  <option value="eq">=</option>
                  <option value="contains">enthält</option>
                </select>
                {isMoneyField(c.field) ? (
                  <div className="relative">
                    <MoneyInput
                      valueCents={parseMoneyInputToCents(c.value) ?? 0}
                      onChange={(cents) =>
                        setDraft((d) => {
                          const next = [...d.conditions];
                          next[i] = {
                            ...c,
                            value: centsToMoneyInput(cents ?? 0),
                          };
                          return { ...d, conditions: next };
                        })
                      }
                      className="input-sm w-full pr-8"
                      placeholder="0,00"
                    />
                    <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs text-brand-navy/50">
                      €
                    </span>
                  </div>
                ) : (
                  <input
                    className="input-sm font-mono sm:col-span-1"
                    value={c.value}
                    onChange={(e) =>
                      setDraft((d) => {
                        const next = [...d.conditions];
                        next[i] = { ...c, value: e.target.value };
                        return { ...d, conditions: next };
                      })
                    }
                  />
                )}
                <button
                  type="button"
                  className="text-xs text-zinc-400 hover:text-red-600"
                  onClick={() =>
                    setDraft((d) => ({
                      ...d,
                      conditions: d.conditions.filter((_, j) => j !== i),
                    }))
                  }
                >
                  Entfernen
                </button>
              </div>
            ))}
          </section>

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-brand-navy/60">
                Aktionen
              </h3>
              <button
                type="button"
                className="text-xs font-semibold text-brand-burgundy"
                onClick={() =>
                  setDraft((d) => ({
                    ...d,
                    actions: [
                      ...d.actions,
                      {
                        type: "add_free_gift",
                        variant_id: "",
                        variant_label: "",
                        qty: "1",
                      },
                    ],
                  }))
                }
              >
                + Aktion
              </button>
            </div>
            {draft.actions.map((a, i) => (
              <ActionEditor
                key={i}
                action={a}
                onChange={(next) =>
                  setDraft((d) => {
                    const actions = [...d.actions];
                    actions[i] = next;
                    return { ...d, actions };
                  })
                }
                onRemove={() =>
                  setDraft((d) => ({
                    ...d,
                    actions: d.actions.filter((_, j) => j !== i),
                  }))
                }
                onPickVariant={() => setPickerIndex(i)}
              />
            ))}
          </section>

          <div className="flex flex-wrap items-end gap-3 border-t border-zinc-200 pt-4">
            <Field label="Order-ID (Test / Anwenden)">
              <input
                className="input-sm font-mono"
                value={dryOrderId}
                onChange={(e) => setDryOrderId(e.target.value)}
                placeholder="Shopify Order ID"
              />
            </Field>
            <button
              type="button"
              className="btn-secondary text-sm"
              disabled={pending || !dryOrderId.trim()}
              onClick={() =>
                startTransition(async () => {
                  const res = await dryRunRuleAction(
                    dryOrderId.trim(),
                    draft.trigger,
                  );
                  if (res.ok) {
                    setDryResult(res.detail ?? "");
                    dispatchAdminJobSuccess({
                      title: "Automatismen",
                      message: "Dry-Run ausgeführt.",
                    });
                  } else {
                    dispatchAdminJobError({
                      title: "Automatismen",
                      message: res.error,
                    });
                  }
                })
              }
            >
              Dry-Run
            </button>
            <button
              type="button"
              className="btn-secondary text-sm"
              disabled={pending || !dryOrderId.trim()}
              onClick={() =>
                startTransition(async () => {
                  const res = await runRuleAction(
                    dryOrderId.trim(),
                    draft.trigger,
                  );
                  if (res.ok) {
                    setDryResult(res.detail ?? "");
                    dispatchAdminJobSuccess({
                      title: "Automatismen",
                      message: "Regeln angewendet.",
                    });
                  } else {
                    dispatchAdminJobError({
                      title: "Automatismen",
                      message: res.error,
                    });
                  }
                })
              }
            >
              Jetzt anwenden
            </button>
            <div className="ml-auto flex gap-2">
              <button
                type="button"
                className="btn-secondary text-sm"
                onClick={() => setEditing(false)}
              >
                Abbrechen
              </button>
              <button
                type="button"
                className="btn-primary text-sm disabled:opacity-50"
                disabled={pending || !draft.name.trim()}
                onClick={save}
              >
                {pending ? "Speichern…" : "Speichern"}
              </button>
            </div>
          </div>

          {dryResult ? (
            <pre className="max-h-60 overflow-auto rounded bg-brand-navy p-3 text-xs text-white/90">
              {dryResult}
            </pre>
          ) : null}
        </div>
      ) : null}

      <VariantPickerModal
        open={pickerIndex != null}
        selectedId={pickerAction?.variant_id}
        onClose={() => setPickerIndex(null)}
        onSelect={(v: GiftVariantOption) => {
          if (pickerIndex == null) return;
          setDraft((d) => {
            const actions = [...d.actions];
            const cur = actions[pickerIndex];
            if (!cur || cur.type !== "add_free_gift") return d;
            actions[pickerIndex] = {
              ...cur,
              variant_id: v.variantId,
              variant_label: formatVariantLabel(v),
            };
            return { ...d, actions };
          });
        }}
      />
    </div>
  );
}

function ActionEditor({
  action,
  onChange,
  onRemove,
  onPickVariant,
}: {
  action: ActionDraft;
  onChange: (a: ActionDraft) => void;
  onRemove: () => void;
  onPickVariant: () => void;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-4">
      <select
        className="input-sm"
        value={action.type}
        onChange={(e) => {
          const type = e.target.value as ActionDraft["type"];
          if (type === "add_free_gift") {
            onChange({
              type,
              variant_id: "",
              variant_label: "",
              qty: "1",
            });
          } else if (type === "add_local_tag" || type === "remove_local_tag") {
            onChange({ type, tag: "" });
          } else if (type === "set_priority_score") {
            onChange({ type, score: "80" });
          } else {
            onChange({ type });
          }
        }}
      >
        <option value="add_free_gift">Gratisbeigabe</option>
        <option value="add_local_tag">Lokaler Tag +</option>
        <option value="remove_local_tag">Lokaler Tag −</option>
        <option value="set_priority_score">Priority-Score</option>
        <option value="hold_order">Order halten</option>
        <option value="release_hold">Hold lösen</option>
      </select>
      {action.type === "add_free_gift" ? (
        <>
          <button
            type="button"
            onClick={onPickVariant}
            className="col-span-1 truncate rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-left text-sm text-brand-navy transition hover:border-brand-navy/40 sm:col-span-2"
            title={action.variant_label || undefined}
          >
            {action.variant_label || (
              <span className="text-brand-navy/40">Variante auswählen…</span>
            )}
          </button>
          <input
            className="input-sm font-mono"
            type="number"
            min={1}
            value={action.qty}
            onChange={(e) => onChange({ ...action, qty: e.target.value })}
            title="Menge"
          />
        </>
      ) : null}
      {action.type === "add_local_tag" || action.type === "remove_local_tag" ? (
        <input
          className="input-sm font-mono sm:col-span-2"
          placeholder="Tag"
          value={action.tag}
          onChange={(e) => onChange({ ...action, tag: e.target.value })}
        />
      ) : null}
      {action.type === "set_priority_score" ? (
        <input
          className="input-sm font-mono sm:col-span-2"
          type="number"
          min={0}
          max={100}
          value={action.score}
          onChange={(e) => onChange({ ...action, score: e.target.value })}
        />
      ) : null}
      <button
        type="button"
        className="text-xs text-zinc-400 hover:text-red-600"
        onClick={onRemove}
      >
        Entfernen
      </button>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-navy/60">
        {label}
      </span>
      {children}
    </label>
  );
}

function flattenConditions(node: AutomationConditionNode | null): CondDraft[] {
  if (!node) return [];
  const leaves = node.all ?? (node.field ? [node] : []);
  return leaves
    .filter((n) => n.field && n.op)
    .map((n) => {
      const field = n.field!;
      const op = (
        n.op === "gte" ||
        n.op === "lt" ||
        n.op === "lte" ||
        n.op === "eq" ||
        n.op === "contains"
          ? n.op
          : "gt"
      ) as CondDraft["op"];
      if (isMoneyField(field)) {
        const cents = typeof n.value === "number" ? n.value : Number(n.value);
        return {
          field,
          op,
          value: centsToMoneyInput(Number.isFinite(cents) ? cents : 0),
        };
      }
      return { field, op, value: String(n.value ?? "") };
    });
}

function buildConditions(
  drafts: CondDraft[],
): AutomationConditionNode | undefined | "invalid_money" {
  if (drafts.length === 0) return undefined;
  const leaves: AutomationConditionNode[] = [];
  for (const d of drafts) {
    if (!d.field || d.value === "") continue;
    const boolField = d.field.startsWith("order.has_");
    let value: unknown = d.value;
    if (boolField) {
      value = d.value === "true" || d.value === "1";
    } else if (isMoneyField(d.field)) {
      const cents = parseMoneyInputToCents(d.value);
      if (cents == null) return "invalid_money";
      value = cents;
    } else if (d.field.includes("count") || d.field.includes("score")) {
      value = Number(d.value);
    }
    leaves.push({ field: d.field, op: d.op, value });
  }
  if (leaves.length === 0) return undefined;
  if (leaves.length === 1) return leaves[0];
  return { all: leaves };
}

function actionToDraft(a: AutomationAction): ActionDraft {
  switch (a.type) {
    case "add_free_gift":
      return {
        type: "add_free_gift",
        variant_id: a.variant_id,
        variant_label: a.variant_id ? `Variante ${a.variant_id}` : "",
        qty: String(a.qty ?? 1),
      };
    case "add_local_tag":
      return { type: "add_local_tag", tag: a.tag };
    case "remove_local_tag":
      return { type: "remove_local_tag", tag: a.tag };
    case "set_priority_score":
      return { type: "set_priority_score", score: String(a.score) };
    case "hold_order":
      return { type: "hold_order" };
    case "release_hold":
      return { type: "release_hold" };
  }
}

function draftToAction(a: ActionDraft): AutomationAction | null {
  switch (a.type) {
    case "add_free_gift":
      if (!a.variant_id.trim()) return null;
      return {
        type: "add_free_gift",
        variant_id: a.variant_id.trim(),
        qty: Math.max(1, Number(a.qty) || 1),
      };
    case "add_local_tag":
      if (!a.tag.trim()) return null;
      return { type: "add_local_tag", tag: a.tag.trim() };
    case "remove_local_tag":
      if (!a.tag.trim()) return null;
      return { type: "remove_local_tag", tag: a.tag.trim() };
    case "set_priority_score":
      return {
        type: "set_priority_score",
        score: Math.max(0, Math.min(100, Number(a.score) || 0)),
      };
    case "hold_order":
      return { type: "hold_order" };
    case "release_hold":
      return { type: "release_hold" };
  }
}
