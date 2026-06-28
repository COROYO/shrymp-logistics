import { encodeCode128 } from "@/lib/barcode/code128";

/**
 * Renders a Code 128-B barcode as inline SVG (no client JS, print-friendly).
 * Width scales with content; height is fixed via `height`. The SVG uses a
 * viewBox in module units so it stays crisp at any print size.
 */
export function Barcode128({
  value,
  height = 48,
  moduleWidth = 1,
  className,
  showValue = false,
}: {
  value: string;
  height?: number;
  moduleWidth?: number;
  className?: string;
  showValue?: boolean;
}) {
  const geo = encodeCode128(value);
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
        aria-label={`Barcode ${geo.value}`}
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
