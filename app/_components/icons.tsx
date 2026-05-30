/**
 * Hand-picked Heroicons-style 20×20 stroke icons, inlined to avoid an extra
 * dependency. Keep them lightweight — sidebar only.
 */
type IconProps = { className?: string };

function Svg({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? "h-5 w-5"}
      aria-hidden
    >
      {children}
    </svg>
  );
}

export function HomeIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M3 10 10 3l7 7" />
      <path d="M5 8.5V16a1 1 0 0 0 1 1h3v-4h2v4h3a1 1 0 0 0 1-1V8.5" />
    </Svg>
  );
}

export function OrdersIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M5 3h7l4 4v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
      <path d="M12 3v4h4" />
      <path d="M7 11h6M7 14h6" />
    </Svg>
  );
}

export function CustomersIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="8" cy="7.5" r="2.5" />
      <path d="M3.5 16c.5-2.5 2.4-4 4.5-4s4 1.5 4.5 4" />
      <circle cx="14" cy="6.5" r="2" />
      <path d="M12.5 12c2 0 3.7 1.3 4 3.5" />
    </Svg>
  );
}

export function AllocationsIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M3 6h6v3H3zM11 11h6v3h-6z" />
      <path d="M6 9v2a2 2 0 0 0 2 2h3" />
    </Svg>
  );
}

export function BatchesIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M4 7 10 4l6 3-6 3-6-3Z" />
      <path d="M4 7v6l6 3 6-3V7" />
      <path d="M10 10v6" />
    </Svg>
  );
}

export function ProductsIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M3 6h14l-1 11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1L3 6Z" />
      <path d="M7 6V4a3 3 0 0 1 6 0v2" />
    </Svg>
  );
}

export function UsersIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="10" cy="7" r="3" />
      <path d="M3.5 17c.6-3 3.3-5 6.5-5s5.9 2 6.5 5" />
    </Svg>
  );
}

export function SettingsIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="10" cy="10" r="2.2" />
      <path d="M10 2.5v2M10 15.5v2M17.5 10h-2M4.5 10h-2M15.3 4.7 13.9 6M6.1 13.9l-1.4 1.4M15.3 15.3 13.9 14M6.1 6.1 4.7 4.7" />
    </Svg>
  );
}

export function PickingIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M3 8h14v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8Z" />
      <path d="M3 8l2-4h10l2 4" />
      <path d="M7 11h6" />
    </Svg>
  );
}

export function LagerIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M3 9l7-5 7 5v8H3z" />
      <path d="M7 17v-4h6v4" />
    </Svg>
  );
}

export function AdminIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M10 2 3 5v5c0 3.5 2.8 6.7 7 8 4.2-1.3 7-4.5 7-8V5l-7-3Z" />
    </Svg>
  );
}

export function HistoryIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M3.5 10a6.5 6.5 0 1 1 1.9 4.6" />
      <path d="M3.5 14v-3.5H7" />
      <path d="M10 6.5V10l2.5 1.5" />
    </Svg>
  );
}

export function EditIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M13.5 4.5 15.5 6.5 7 15H5v-2z" />
      <path d="M12 6 14 8" />
    </Svg>
  );
}

export function ArchiveIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M3.5 5.5h13v3h-13z" />
      <path d="M4.5 8.5V15a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V8.5" />
      <path d="M8 11h4" />
    </Svg>
  );
}
