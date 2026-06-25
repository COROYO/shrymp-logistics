/**
 * Strips the Lager header/nav for the printable view.
 * Renders only `children` (the print page itself).
 */
export default function PrintLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
