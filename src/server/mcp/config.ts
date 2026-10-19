// MCP/OAuth settings derived from BETTER_AUTH_URL. Pure: no side effects on import.
export const MCP_SCOPES = {
  read: "taskode:read",
  write: "taskode:write",
  admin: "taskode:admin",
} as const;
export type McpScope = (typeof MCP_SCOPES)[keyof typeof MCP_SCOPES];
export const OAUTH_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  MCP_SCOPES.read,
  MCP_SCOPES.write,
  MCP_SCOPES.admin,
];
// Advertised in WWW-Authenticate so clients ask for refresh tokens and every capability up front.
export const MCP_CHALLENGE_SCOPES = [
  MCP_SCOPES.read,
  MCP_SCOPES.write,
  MCP_SCOPES.admin,
  "offline_access",
];
export const ACCESS_TOKEN_SECONDS = 60 * 60;
export const ADMIN_ACCESS_TOKEN_SECONDS = 15 * 60;
export const REFRESH_TOKEN_SECONDS = 30 * 24 * 60 * 60;

export function mcpUrls(base = process.env.BETTER_AUTH_URL || "http://localhost:5010") {
  const origin = new URL(base).origin;
  return {
    origin,
    issuer: `${origin}/api/auth`,
    resource: `${origin}/api/mcp`,
    jwks: `${origin}/api/auth/jwks`,
    protectedResourceMetadata: `${origin}/.well-known/oauth-protected-resource/api/mcp`,
  };
}
export function mcpEnabled(env: Record<string, string | undefined> = process.env) {
  return env.MCP_ENABLED !== "false";
}
// Browser-based MCP clients (e.g. MCP Inspector in direct mode) need their origin listed.
export function mcpAllowedOrigins(env: Record<string, string | undefined> = process.env) {
  const origins = new Set([mcpUrls(env.BETTER_AUTH_URL || undefined).origin]);
  for (const value of (env.MCP_ALLOWED_ORIGINS || "").split(",")) {
    const entry = value.trim();
    if (!entry) continue;
    try {
      origins.add(new URL(entry).origin);
    } catch {}
  }
  return origins;
}
