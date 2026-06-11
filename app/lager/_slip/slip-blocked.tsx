import Link from "next/link";
import type { SlipAssignmentBlockReason } from "@/server/picking/slip-data";

export function SlipBlockedMessage({
  orderId,
  orderName,
  reason,
  minDays,
}: {
  orderId: string;
  orderName?: string;
  reason: SlipAssignmentBlockReason;
  minDays: number;
}) {
  const title =
    reason === "near_expiry"
      ? "Lieferschein nicht möglich"
      : "Chargen-Zuordnung unvollständig";

  const body =
    reason === "near_expiry"
      ? `Für diese Bestellung stehen nur Chargen mit einem MHD in ${minDays} Tagen oder weniger zur Verfügung. Diese dürfen nicht mehr zugeordnet werden. Bitte frischere Ware einbuchen oder die Einstellung unter Admin → Einstellungen prüfen.`
      : "Die Chargen-Zuordnung ist unvollständig. Der Lieferschein wird erst gedruckt, wenn alle Positionen einer gültigen Charge zugeordnet sind.";

  return (
    <div className="mx-auto mt-16 max-w-lg space-y-4 p-6">
      <p className="eyebrow text-brand-burgundy">Lieferschein</p>
      <h1 className="h-display text-2xl text-brand-navy">{title}</h1>
      {orderName ? (
        <p className="font-mono text-sm text-brand-navy/70">{orderName}</p>
      ) : null}
      <p className="text-sm leading-relaxed text-brand-ink">{body}</p>
      <Link
        href={`/lager/picking/${orderId}`}
        className="inline-flex text-sm font-semibold text-brand-burgundy underline-offset-2 hover:underline"
      >
        Zurück zur Kommissionierung
      </Link>
    </div>
  );
}
