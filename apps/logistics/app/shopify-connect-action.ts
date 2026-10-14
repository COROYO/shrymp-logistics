"use server";

import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { normalizeShopDomainInput } from "@/server/tenant/id";
import {
  parseShopifyAppCredentials,
  savePendingShopifyApp,
} from "@/server/shopify/app-credentials";

export async function startShopifyConnectAction(input: {
  shopDomain: string;
  clientId: string;
  clientSecret: string;
}): Promise<{ ok: false; error: string }> {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/onboarding");
  if (user.role !== "ADMIN") {
    return { ok: false, error: "Nur Shop-Admins können Shopify verbinden." };
  }

  const shop = normalizeShopDomainInput(input.shopDomain);
  if (!shop) {
    return {
      ok: false,
      error:
        "Ungültige Shop-Domain — bitte z. B. mein-shop oder mein-shop.myshopify.com angeben.",
    };
  }

  const creds = parseShopifyAppCredentials(input.clientId, input.clientSecret);
  if (!creds) {
    return {
      ok: false,
      error: "Bitte eine gültige Client ID und ein Client Secret eintragen.",
    };
  }

  await savePendingShopifyApp({ shopId: shop, ownerUid: user.uid, creds });
  redirect(`/api/shopify/install?shop=${encodeURIComponent(shop)}`);
}
