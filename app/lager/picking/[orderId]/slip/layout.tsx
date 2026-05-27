/**
 * Strips the Lager header/nav for the printable packing-slip view.
 * Renders only `children` (the slip itself, optimized for A4 print).
 */
export default function SlipLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
