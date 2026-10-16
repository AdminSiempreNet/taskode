import type { NextConfig } from "next";
const config: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  serverExternalPackages: ["@libsql/client", "libsql"],
  outputFileTracingIncludes: { "/*": ["./drizzle/**/*"] },
  outputFileTracingExcludes: { "/*": ["./data/**/*", "./test-results/**/*"] },
};
export default config;
