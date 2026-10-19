import {
  oauthProviderAuthServerMetadata,
  oauthProviderOpenIdConfigMetadata,
} from "@better-auth/oauth-provider";
import { authConfigured, getAuth } from "../auth";
import { repository } from "../index";
import { mcpEnabled } from "./config";
import { publicPreflight, withPublicCors } from "./cors";

type Document = "protected-resource" | "authorization-server" | "openid-configuration";
const METHODS = "GET, HEAD, OPTIONS";
const notFound = () =>
  Response.json({ error: "not_found" }, { status: 404, headers: { "Cache-Control": "no-store" } });

// Better Auth lives under /api/auth, so the RFC 8414/9728 documents at the domain root
// are forwarded here. Plugins answer the issuer-path aliases from the auth handler; only the
// root aliases need the provider's metadata helpers.
export function wellKnownHandler(document: Document) {
  return async (request: Request) => {
    if (!authConfigured() || !mcpEnabled()) return notFound();
    await repository().store.ready;
    const auth = getAuth();
    const path = new URL(request.url).pathname.replace(/\/+$/, "");
    let response: Response;
    if (document === "protected-resource") response = await auth.handle(request);
    else if (document === "authorization-server")
      response =
        path === "/.well-known/oauth-authorization-server"
          ? await oauthProviderAuthServerMetadata(auth.instance)(request)
          : await auth.handle(request);
    else if (
      path === "/.well-known/openid-configuration" ||
      path === "/.well-known/openid-configuration/api/auth"
    )
      response = await oauthProviderOpenIdConfigMetadata(auth.instance)(request);
    else return notFound();
    return withPublicCors(response, METHODS);
  };
}
export function wellKnownPreflight() {
  return publicPreflight(METHODS);
}
