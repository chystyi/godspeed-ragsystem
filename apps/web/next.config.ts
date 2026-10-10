import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

// One .env at the repository root serves the API and the web app; Next.js itself only
// looks in this app's folder. loadEnvConfig remembers its first load, so reloading is forced.
loadEnvConfig(path.resolve(import.meta.dirname, "../.."), process.env.NODE_ENV !== "production", console, true);

const isProduction = process.env.NODE_ENV === "production";
const origin = (url: string | undefined) => {
  try {
    return url ? new URL(url).origin : "";
  } catch {
    return "";
  }
};

// Pages are prerendered, so a per-request nonce is not possible and inline scripts stay allowed.
// What the policy does limit: where code and styles load from, where the page may send data
// (only this site, the API and Supabase), who may frame it, and what a stray <base> or <form> can do.
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProduction ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  `connect-src 'self' ${origin(process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000")} ${origin(process.env.NEXT_PUBLIC_SUPABASE_URL)}${isProduction ? "" : " ws: http://localhost:*"}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
  // A self-contained server for the Docker image (traced from the repository root, where the workspaces live).
  output: "standalone",
  outputFileTracingRoot: path.resolve(import.meta.dirname, "../.."),
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
