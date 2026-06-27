import { SettingsNav } from "./settings-nav";

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-8">
      <div>
        <p className="eyebrow">System</p>
        <h1 className="h-display mt-1 text-3xl">Einstellungen</h1>
      </div>

      <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
        <aside className="w-full shrink-0 lg:w-52">
          <div className="card p-3 lg:sticky lg:top-8">
            <SettingsNav />
          </div>
        </aside>
        <div className="min-w-0 flex-1 space-y-6">{children}</div>
      </div>
    </div>
  );
}
