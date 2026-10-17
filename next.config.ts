import type { NextConfig } from "next";
const config: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  serverExternalPackages: ["pg"],
  outputFileTracingIncludes: { "/*": ["./drizzle/postgresql/**/*"] },
  outputFileTracingExcludes: { "/*": ["./data/**/*", "./test-results/**/*"] },
};
export default config;
