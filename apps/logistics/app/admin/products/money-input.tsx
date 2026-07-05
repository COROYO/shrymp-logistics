"use client";

import { useEffect, useState } from "react";
import {
  centsToMoneyInput,
  parseMoneyInputToCents,
} from "@/lib/money-input";

const defaultClass =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm transition focus:border-brand-navy focus:outline-none focus:ring-2 focus:ring-brand-navy/20";

export function MoneyInput({
  valueCents,
  onChange,
  className = defaultClass,
  placeholder = "0,00",
  disabled,
}: {
  valueCents: number | null | undefined;
  onChange: (cents: number | null) => void;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState(() => centsToMoneyInput(valueCents));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(centsToMoneyInput(valueCents));
  }, [valueCents, focused]);

  return (
    <input
      type="text"
      inputMode="decimal"
      disabled={disabled}
      value={focused ? text : centsToMoneyInput(valueCents)}
      placeholder={placeholder}
      onFocus={() => {
        setFocused(true);
        setText(centsToMoneyInput(valueCents));
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        setFocused(false);
        onChange(parseMoneyInputToCents(text));
      }}
      className={className}
    />
  );
}
