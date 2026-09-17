import type { AutomationConditionNode } from "@/server/firestore/schema";
import type { EvalContext } from "./context";

/**
 * Evaluate a condition tree against a flat context.
 * Empty / missing node ⇒ true (rule always matches).
 */
export function evaluateConditions(
  node: AutomationConditionNode | undefined,
  ctx: EvalContext,
): boolean {
  if (!node) return true;
  if (node.all && node.all.length > 0) {
    return node.all.every((n) => evaluateConditions(n, ctx));
  }
  if (node.any && node.any.length > 0) {
    return node.any.some((n) => evaluateConditions(n, ctx));
  }
  if (!node.field || !node.op) return true;
  return compare(resolveField(ctx, node.field), node.op, node.value);
}

function resolveField(ctx: EvalContext, field: string): unknown {
  const parts = field.split(".");
  let cur: unknown = ctx;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function compare(
  left: unknown,
  op: NonNullable<AutomationConditionNode["op"]>,
  right: unknown,
): boolean {
  switch (op) {
    case "exists":
      return left !== undefined && left !== null;
    case "eq":
      return left === right;
    case "neq":
      return left !== right;
    case "gt":
      return num(left) > num(right);
    case "gte":
      return num(left) >= num(right);
    case "lt":
      return num(left) < num(right);
    case "lte":
      return num(left) <= num(right);
    case "in": {
      if (!Array.isArray(right)) return false;
      if (Array.isArray(left)) {
        return left.some((v) => right.includes(v));
      }
      return right.includes(left);
    }
    case "contains": {
      if (typeof left === "string" && typeof right === "string") {
        return left.includes(right);
      }
      if (Array.isArray(left)) {
        return left.includes(right);
      }
      return false;
    }
    default:
      return false;
  }
}

function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) {
    return Number(v);
  }
  return Number.NaN;
}
