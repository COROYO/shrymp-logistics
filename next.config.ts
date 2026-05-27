import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Allow Shopify-hosted product images (`unoptimized` is set per-Image
    // anyway, but listing them here keeps the door open for optimization later).
    remotePatterns: [
      { protocol: "https", hostname: "cdn.shopify.com" },
      { protocol: "https", hostname: "*.myshopify.com" },
    ],
  },
};

export default nextConfig;
