"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AdminIcon,
  AllocationsIcon,
  BatchesIcon,
  BinsIcon,
  CustomersIcon,
  HomeIcon,
  LagerIcon,
  OrdersIcon,
  PackedIcon,
  PickingIcon,
  ProductsIcon,
  ScanIcon,
  SettingsIcon,
  UsersIcon,
} from "./icons";
import { LogoutButton } from "./logout-button";
import { useTranslations } from "next-intl";

/**
 * Sidebar receives icons by string key (not component) because items are
 * defined in Server Components — functions can't cross the server/client
 * boundary. Add new icons to ICON_MAP here.
 */
export type IconKey =
  | "home"
  | "orders"
  | "customers"
  | "allocations"
  | "batches"
  | "products"
  | "users"
  | "settings"
  | "picking"
  | "packed"
  | "lager"
  | "bins"
  | "scan"
  | "admin";

const ICON_MAP: Record<IconKey, React.ComponentType<{ className?: string }>> = {
  home: HomeIcon,
  orders: OrdersIcon,
  customers: CustomersIcon,
  allocations: AllocationsIcon,
  batches: BatchesIcon,
  products: ProductsIcon,
  users: UsersIcon,
  settings: SettingsIcon,
  picking: PickingIcon,
  packed: PackedIcon,
  lager: LagerIcon,
  bins: BinsIcon,
  scan: ScanIcon,
  admin: AdminIcon,
};

export type SidebarItem = {
  href: string;
  label: string;
  icon: IconKey;
  /** Optional explicit match function; defaults to startsWith(href). */
  matches?: (pathname: string) => boolean;
};

export type SidebarSection = {
  label?: string;
  items: SidebarItem[];
};

export type SidebarFooter = {
  crossLink?: { href: string; label: string; icon: IconKey };
  userEmail?: string | null;
};

export function Sidebar({
  sections,
  footer,
}: {
  sections: SidebarSection[];
  footer?: SidebarFooter;
}) {
  const pathname = usePathname();
  const t = useTranslations("nav");

  return (
    <nav
      aria-label={t("mainNav")}
      className="flex h-full flex-col gap-1 p-4"
    >
      {sections.map((section, i) => (
        <div key={i} className={i > 0 ? "mt-6" : undefined}>
          {section.label ? (
            <div className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/40">
              {section.label}
            </div>
          ) : null}
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const active = item.matches
                ? item.matches(pathname)
                : pathname === item.href ||
                  pathname.startsWith(item.href + "/");
              const Icon = ICON_MAP[item.icon];
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-semibold tracking-tight transition ${
                      active
                        ? "bg-brand-burgundy text-white shadow-sm"
                        : "text-white/70 hover:bg-white/5 hover:text-white"
                    }`}
                  >
                    <Icon
                      className={`h-5 w-5 shrink-0 ${
                        active ? "text-white" : "text-white/50 group-hover:text-white"
                      }`}
                    />
                    <span>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {footer ? (
        <div className="mt-auto border-t border-white/10 px-3 pt-4">
          {footer.crossLink ? (
            <Link
              href={footer.crossLink.href}
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-semibold tracking-tight text-white/70 transition hover:bg-white/5 hover:text-white"
            >
              {(() => {
                const Icon = ICON_MAP[footer.crossLink.icon];
                return <Icon className="h-5 w-5 text-white/50" />;
              })()}
              <span>{footer.crossLink.label}</span>
              <span className="ml-auto text-white/40">→</span>
            </Link>
          ) : null}
          {footer.userEmail !== undefined ? (
            <div className="mt-3 flex items-center justify-between gap-2 px-3 py-2 text-[11px] text-white/60">
              <span className="truncate" title={footer.userEmail ?? undefined}>
                {footer.userEmail ?? "—"}
              </span>
              <LogoutButton />
            </div>
          ) : null}
        </div>
      ) : null}
    </nav>
  );
}
