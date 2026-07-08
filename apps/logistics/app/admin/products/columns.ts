"use client";
import { useEffect, useState } from "react";

/**
 * Toggleable batch-table columns. `charge` and the action column are always
 * shown (identity + controls), so they're not part of this list.
 */
export const TOGGLEABLE_COLUMNS = [
  "expiry",
  "production",
  "remaining",
  "sold",
  "initial",
  "receivedAt",
  "receivedBy",
  "note",
] as const;

export type BatchColumnKey = (typeof TOGGLEABLE_COLUMNS)[number];
export type ColumnVisibility = Record<BatchColumnKey, boolean>;

const STORAGE_KEY = "batches.columnVisibility.v1";

export const DEFAULT_COLUMN_VISIBILITY: ColumnVisibility = {
  expiry: true,
  production: true,
  remaining: true,
  sold: true,
  initial: true,
  receivedAt: true,
  receivedBy: true,
  note: true,
};

function parse(raw: string | null): ColumnVisibility {
  if (!raw) return DEFAULT_COLUMN_VISIBILITY;
  try {
    const obj = JSON.parse(raw) as Partial<ColumnVisibility>;
    return { ...DEFAULT_COLUMN_VISIBILITY, ...obj };
  } catch {
    return DEFAULT_COLUMN_VISIBILITY;
  }
}

/**
 * Column-visibility state persisted to sessionStorage so it survives
 * navigation within the tab without leaking across browser sessions.
 *
 * Starts from DEFAULT_VISIBILITY on the server and the first client paint
 * (avoids a hydration mismatch), then loads the stored preference on mount.
 */
export function useColumnVisibility(): {
  cols: ColumnVisibility;
  toggle: (key: BatchColumnKey) => void;
  reset: () => void;
} {
  const [cols, setCols] = useState<ColumnVisibility>(DEFAULT_COLUMN_VISIBILITY);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    // Hydrate from sessionStorage on mount. This MUST be an effect (not a
    // lazy initializer): sessionStorage doesn't exist during SSR, and reading
    // it in the initializer would desync server vs. client markup. The
    // setState-in-effect here is the intended one-shot hydration, not a
    // cascading-render bug.
    const stored = parse(sessionStorage.getItem(STORAGE_KEY));
    /* eslint-disable react-hooks/set-state-in-effect */
    setCols(stored);
    setHydrated(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(cols));
    } catch {
      // sessionStorage unavailable (private mode etc.) — ignore.
    }
  }, [cols, hydrated]);

  function toggle(key: BatchColumnKey) {
    setCols((c) => ({ ...c, [key]: !c[key] }));
  }
  function reset() {
    setCols(DEFAULT_COLUMN_VISIBILITY);
  }

  return { cols, toggle, reset };
}
