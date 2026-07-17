import Link from "next/link";

export function TestModeBanner() {
  return (
    <div className="mb-6 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
      <p className="font-semibold">Testmodus aktiv</p>
      <p className="mt-1 text-xs">
        Es werden keine Änderungen zu Shopify geschrieben. Geplante Aktionen
        findest du unter{" "}
        <Link
          href="/admin/settings/shopify"
          className="font-semibold text-brand-burgundy underline"
        >
          Einstellungen → Shopify
        </Link>
        .
      </p>
    </div>
  );
}
