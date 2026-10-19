import type { NextConfig } from "next";
const config: NextConfig = {
  ...(process.env.VERCEL === "1" ? {} : { output: "standalone" as const }),
  poweredByHeader: false,
  async headers() {
    // Login and consent carry the signed OAuth query (state, PKCE challenge): never framed or leaked.
    const authPage = [
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
      { key: "Referrer-Policy", value: "no-referrer" },
    ];
    return [
      { source: "/login", headers: authPage },
      { source: "/oauth/:path*", headers: authPage },
      { source: "/invite/:path*", headers: authPage },
      { source: "/api/mcp", headers: [
        { key: "Cache-Control", value: "no-store" },
        { key: "X-Robots-Tag", value: "noindex, nofollow" },
      ] },
      { source: "/share/diagrams/:path*", headers: [
      { key: "Cache-Control", value: "private, no-store" },
      { key: "X-Robots-Tag", value: "noindex, nofollow" },
      { key: "Referrer-Policy", value: "no-referrer" },
    ] }, { source: "/sw.js", headers: [
      { key: "Content-Type", value: "application/javascript; charset=utf-8" },
      { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
      { key: "Service-Worker-Allowed", value: "/" },
      { key: "X-Content-Type-Options", value: "nosniff" },
    ] }];
  },
  serverExternalPackages: ["pg"],
  outputFileTracingIncludes: { "/*": ["./drizzle/postgresql/**/*"] },
  outputFileTracingExcludes: { "/*": ["./data/**/*", "./test-results/**/*"] },
};
export default config;
