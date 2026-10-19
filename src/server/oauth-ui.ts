import { verifyOAuthQueryParams } from "@better-auth/oauth-provider";
import { eq } from "drizzle-orm";
import { repository } from "./index";
import * as schema from "./schema";

export type PageSearchParams = Record<string, string | string[] | undefined>;
export interface OAuthClientView {
  name: string;
  verifiedHost?: string;
  dynamic: boolean;
  redirectHost: string;
  loopback: boolean;
}
export type OAuthRequestView =
  | { status: "valid"; query: string; client: OAuthClientView; scopes: string[] }
  | { status: "invalid" };

export function searchParamsToQuery(params: PageSearchParams) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    for (const item of [value ?? []].flat()) query.append(key, item);
  return query;
}
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
function redirectTarget(redirectUri: string | null) {
  try {
    const url = new URL(redirectUri ?? "");
    const web = url.protocol === "https:" || url.protocol === "http:";
    return {
      redirectHost: web ? url.host : `${url.protocol}//`,
      loopback: !web || LOOPBACK.has(url.hostname),
    };
  } catch {
    return { redirectHost: "", loopback: false };
  }
}
// Describes the OAuth request carried by /login and /oauth/consent. Only the signed query
// issued by /oauth2/authorize is trusted; null means the page was opened without one.
export async function oauthRequestView(
  params: PageSearchParams,
  secret = process.env.BETTER_AUTH_SECRET || "",
): Promise<OAuthRequestView | null> {
  const query = searchParamsToQuery(params);
  if (!query.has("sig")) return null;
  // Same selection as the client plugin: only parameters declared by ba_param are signed.
  const names = new Set(["sig", "ba_param", ...query.getAll("ba_param")]);
  const signed = new URLSearchParams(
    [...query].filter(([key]) => names.has(key)),
  ).toString();
  if (!secret || !(await verifyOAuthQueryParams(signed, secret)))
    return { status: "invalid" };
  const clientId = query.get("client_id") ?? "";
  const repo = repository();
  await repo.store.ready;
  const client = (
    await repo.store.db
      .select({
        name: schema.oauthClient.name,
        disabled: schema.oauthClient.disabled,
        discovery: schema.oauthClient.clientDiscoveryId,
        owner: schema.oauthClient.userId,
      })
      .from(schema.oauthClient)
      .where(eq(schema.oauthClient.clientId, clientId))
  )[0];
  if (!client || client.disabled) return { status: "invalid" };
  let verifiedHost: string | undefined;
  if (client.discovery)
    try {
      verifiedHost = new URL(clientId).host;
    } catch {}
  return {
    status: "valid",
    query: signed,
    client: {
      name: client.name || verifiedHost || "Aplicación sin nombre",
      verifiedHost,
      dynamic: !client.discovery && !client.owner,
      ...redirectTarget(query.get("redirect_uri")),
    },
    scopes: (query.get("scope") ?? "").split(" ").filter(Boolean),
  };
}
