"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SETTINGS_NAV, type SettingsNavItem } from "./settings-nav-config";

function isActive(pathname: string, item: SettingsNavItem): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(item.href + "/");
}

export function SettingsNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Einstellungen"
      className="space-y-6"
    >
      <ul className="space-y-0.5">
        <li>
          <Link
            href="/admin/settings"
            aria-current={pathname === "/admin/settings" ? "page" : undefined}
            className={`block rounded-md px-3 py-2 text-sm font-semibold transition ${
              pathname === "/admin/settings"
                ? "bg-brand-burgundy text-white"
                : "text-brand-navy/70 hover:bg-zinc-100 hover:text-brand-navy"
            }`}
          >
            Übersicht
          </Link>
        </li>
      </ul>

      {SETTINGS_NAV.map((group) => (
        <div key={group.label}>
          <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-navy/45">
            {group.label}
          </p>
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const active = isActive(pathname, item);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`block rounded-md px-3 py-2 text-sm font-semibold transition ${
                      active
                        ? "bg-brand-burgundy text-white"
                        : "text-brand-navy/70 hover:bg-zinc-100 hover:text-brand-navy"
                    }`}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
