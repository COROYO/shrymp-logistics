"use client";

import { useRef, useState } from "react";
import { CloseIcon } from "@/app/_components/icons";

const containerClass =
  "mt-1.5 flex min-h-[42px] cursor-text flex-wrap items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-2 py-1.5 shadow-sm transition focus-within:border-brand-navy focus-within:ring-2 focus-within:ring-brand-navy/20";

export function OptionValuesPillInput({
  values,
  onChange,
  placeholder,
  removeLabel,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  removeLabel: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");

  function appendValues(candidates: string[]) {
    const next = [...values];
    for (const raw of candidates) {
      const value = raw.trim();
      if (!value || next.includes(value)) continue;
      next.push(value);
    }
    if (next.length !== values.length) onChange(next);
  }

  function commitDraft(raw?: string) {
    const text = (raw ?? draft).trim();
    setDraft("");
    if (!text) return;
    appendValues([text]);
  }

  function removeValue(value: string) {
    onChange(values.filter((v) => v !== value));
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "," || e.key === "Enter") {
      e.preventDefault();
      commitDraft();
      return;
    }
    if (e.key === "Backspace" && draft === "" && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.value;
    if (next.includes(",")) {
      const parts = next.split(",");
      appendValues(parts.slice(0, -1));
      setDraft(parts[parts.length - 1] ?? "");
      return;
    }
    setDraft(next);
  }

  return (
    <div
      className={containerClass}
      onClick={() => inputRef.current?.focus()}
    >
      {values.map((value) => (
        <span
          key={value}
          className="group inline-flex max-w-full items-center gap-1 rounded-md bg-brand-cream px-2 py-0.5 text-sm font-medium text-brand-navy ring-1 ring-zinc-200/80"
        >
          <span className="truncate">{value}</span>
          <button
            type="button"
            aria-label={`${removeLabel}: ${value}`}
            onClick={(e) => {
              e.stopPropagation();
              removeValue(value);
            }}
            className="inline-flex h-4 w-0 shrink-0 items-center justify-center overflow-hidden rounded opacity-0 transition-all group-hover:w-4 group-hover:opacity-100 hover:bg-brand-burgundy/10 hover:text-brand-burgundy"
          >
            <CloseIcon className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        value={draft}
        onChange={onInputChange}
        onKeyDown={onKeyDown}
        onBlur={() => commitDraft()}
        placeholder={values.length === 0 ? placeholder : undefined}
        className="min-w-[5rem] flex-1 border-0 bg-transparent px-1 py-1 text-sm outline-none placeholder:text-brand-navy/40"
      />
    </div>
  );
}
