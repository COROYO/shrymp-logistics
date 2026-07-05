"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

const inputClass =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm transition focus:border-brand-navy focus:outline-none focus:ring-2 focus:ring-brand-navy/20";

type Mode = "visual" | "html";
type BlockTag = "p" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6";

const HEADING_TAGS: BlockTag[] = ["h1", "h2", "h3", "h4", "h5", "h6"];

export function ProductHtmlEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (html: string) => void;
}) {
  const t = useTranslations("productEditor");
  const [mode, setMode] = useState<Mode>("visual");
  const editorRef = useRef<HTMLDivElement>(null);
  const isFocused = useRef(false);
  const lastCommitted = useRef(value);

  const syncVisualFromValue = useCallback((html: string) => {
    const el = editorRef.current;
    if (!el) return;
    if (el.innerHTML !== html) {
      el.innerHTML = html;
    }
  }, []);

  useEffect(() => {
    lastCommitted.current = value;
    if (mode !== "visual" || isFocused.current) return;
    syncVisualFromValue(value);
  }, [value, mode, syncVisualFromValue]);

  function commitHtml() {
    if (!editorRef.current) return;
    const html = editorRef.current.innerHTML;
    lastCommitted.current = html;
    onChange(html);
  }

  function exec(command: string, val?: string) {
    editorRef.current?.focus();
    document.execCommand(command, false, val);
    commitHtml();
  }

  function formatBlock(tag: BlockTag) {
    editorRef.current?.focus();
    if (!document.execCommand("formatBlock", false, tag)) {
      document.execCommand("formatBlock", false, `<${tag}>`);
    }
    commitHtml();
  }

  function addLink() {
    const url = window.prompt(t("htmlLinkPrompt"));
    if (!url?.trim()) return;
    exec("createLink", url.trim());
  }

  function switchMode(next: Mode) {
    if (next === mode) return;
    if (next === "visual") {
      setMode("visual");
      requestAnimationFrame(() => syncVisualFromValue(lastCommitted.current));
      return;
    }
    if (mode === "visual" && editorRef.current) {
      commitHtml();
    }
    setMode("html");
  }

  function keepEditorFocus(e: React.MouseEvent) {
    // Prevent toolbar clicks from blurring the contentEditable surface.
    e.preventDefault();
  }

  return (
    <div className="space-y-2">
      <div
        className="space-y-1 rounded-md border border-zinc-200 bg-zinc-50 p-1"
        onMouseDown={mode === "visual" ? keepEditorFocus : undefined}
      >
        <div className="flex flex-wrap items-center gap-1">
          <ToolbarButton
            active={mode === "visual"}
            onClick={() => switchMode("visual")}
            label={t("htmlVisual")}
          />
          <ToolbarButton
            active={mode === "html"}
            onClick={() => switchMode("html")}
            label={t("htmlSource")}
          />
          {mode === "visual" ? (
            <>
              <span className="mx-1 h-5 w-px bg-zinc-300" />
              <ToolbarButton onClick={() => exec("bold")} label="B" bold />
              <ToolbarButton onClick={() => exec("italic")} label="I" italic />
              <ToolbarButton onClick={() => exec("underline")} label="U" underline />
              <ToolbarButton onClick={() => exec("insertUnorderedList")} label="•" />
              <ToolbarButton onClick={() => exec("insertOrderedList")} label="1." />
              <ToolbarButton onClick={addLink} label={t("htmlLink")} />
            </>
          ) : null}
        </div>
        {mode === "visual" ? (
          <div className="flex flex-wrap items-center gap-1 border-t border-zinc-200 pt-1">
            <span className="px-1 text-[10px] font-semibold uppercase tracking-wide text-brand-navy/50">
              {t("htmlHeadings")}
            </span>
            {HEADING_TAGS.map((tag) => (
              <ToolbarButton
                key={tag}
                onClick={() => formatBlock(tag)}
                label={tag.toUpperCase()}
                mono
              />
            ))}
            <ToolbarButton onClick={() => formatBlock("p")} label="P" mono />
          </div>
        ) : null}
      </div>

      {mode === "visual" ? (
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          className={`${inputClass} product-html-editor-content min-h-[220px] max-w-none focus:outline-none`}
          onFocus={() => {
            isFocused.current = true;
          }}
          onBlur={() => {
            isFocused.current = false;
            commitHtml();
          }}
        />
      ) : (
        <textarea
          rows={12}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`${inputClass} font-mono text-xs`}
          placeholder={t("descriptionPlaceholder")}
        />
      )}
    </div>
  );
}

function ToolbarButton({
  label,
  onClick,
  active,
  bold: isBold,
  italic: isItalic,
  underline: isUnderline,
  mono,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  mono?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded px-2 py-1 text-xs font-semibold transition ${
        active
          ? "bg-brand-navy text-white"
          : "text-brand-navy hover:bg-white"
      } ${isBold ? "font-bold" : ""} ${isItalic ? "italic" : ""} ${isUnderline ? "underline" : ""} ${mono ? "font-mono text-[10px]" : ""}`}
    >
      {label}
    </button>
  );
}
