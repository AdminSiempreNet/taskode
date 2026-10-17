import type { NextConfig } from "next";
const config: NextConfig = {
  ...(process.env.VERCEL === "1" ? {} : { output: "standalone" as const }),
  poweredByHeader: false,
  serverExternalPackages: ["pg"],
  outputFileTracingIncludes: { "/*": ["./drizzle/postgresql/**/*"] },
  outputFileTracingExcludes: { "/*": ["./data/**/*", "./test-results/**/*"] },
};
export default config;
