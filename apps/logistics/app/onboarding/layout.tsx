import { BrandMark } from "@/app/_components/brand-mark";

export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen flex-col">
      <header className="border-b border-brand-ink/8 bg-white px-6 py-4">
        <BrandMark variant="dark" />
      </header>
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}
