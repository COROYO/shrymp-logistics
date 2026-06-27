export type SettingsNavItem = {
  href: string;
  label: string;
  exact?: boolean;
};

export type SettingsNavGroup = {
  label: string;
  items: SettingsNavItem[];
};

export const SETTINGS_NAV: SettingsNavGroup[] = [
  {
    label: "Integrationen",
    items: [
      { href: "/admin/settings/shopify", label: "Shopify" },
      { href: "/admin/settings/dhl", label: "DHL Versand" },
    ],
  },
  {
    label: "Lager",
    items: [
      { href: "/admin/settings/chargen", label: "Chargen" },
      { href: "/admin/settings/bestand", label: "Bestand" },
    ],
  },
  {
    label: "Betrieb",
    items: [
      { href: "/admin/settings/auftraege", label: "Aufträge & Allocation" },
    ],
  },
  {
    label: "Dokumente",
    items: [
      { href: "/admin/settings/lieferschein", label: "Lieferschein" },
    ],
  },
];
