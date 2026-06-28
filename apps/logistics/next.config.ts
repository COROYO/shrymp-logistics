import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  experimental: {
    optimizePackageImports: ["next-intl"],
  },
  images: {
    // Allow Shopify-hosted product images (`unoptimized` is set per-Image
    // anyway, but listing them here keeps the door open for optimization later).
    remotePatterns: [
      { protocol: "https", hostname: "cdn.shopify.com" },
      { protocol: "https", hostname: "*.myshopify.com" },
    ],
  },
};

export default withNextIntl(nextConfig);
