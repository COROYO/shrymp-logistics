import { BrandMark } from "@/app/_components/brand-mark";

export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen flex-col">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-br from-brand-cream via-brand-cream to-brand-stone"
      />
      <header className="border-b border-zinc-200/80 bg-white/80 px-6 py-4 backdrop-blur-sm">
        <BrandMark variant="dark" />
      </header>
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}
