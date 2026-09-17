import { encodeParsedEan, parseEan, type ParsedEan } from "@/lib/barcode/ean";

/**
 * Renders an EAN-8 or EAN-13 barcode as inline SVG (print-friendly).
 * Pass either a raw string (validated via `parseEan`) or an already-parsed EAN.
 */
export function BarcodeEan({
  value,
  parsed,
  height = 48,
  moduleWidth = 1,
  className,
  showValue = false,
}: {
  value?: string;
  parsed?: ParsedEan;
  height?: number;
  moduleWidth?: number;
  className?: string;
  showValue?: boolean;
}) {
  const ean = parsed ?? (value != null ? parseEan(value) : null);
  if (!ean) return null;

  const geo = encodeParsedEan(ean);
  const width = geo.modules * moduleWidth;

  return (
    <span
      className={className}
      style={{ display: "inline-flex", flexDirection: "column", alignItems: "center" }}
    >
      <svg
        viewBox={`0 0 ${geo.modules} ${height}`}
        width={width}
        height={height}
        preserveAspectRatio="none"
        shapeRendering="crispEdges"
        role="img"
        aria-label={`EAN ${geo.value}`}
      >
        <rect x={0} y={0} width={geo.modules} height={height} fill="#ffffff" />
        {geo.bars.map((b, i) => (
          <rect key={i} x={b.x} y={0} width={b.width} height={height} fill="#000000" />
        ))}
      </svg>
      {showValue ? (
        <span
          style={{
            fontFamily: "monospace",
            fontSize: 11,
            letterSpacing: "0.08em",
            marginTop: 2,
          }}
        >
          {geo.value}
        </span>
      ) : null}
    </span>
  );
}
