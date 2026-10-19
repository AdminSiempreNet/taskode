"use client";
import { createAuthClient } from "better-auth/react";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";
// The OAuth plugin forwards the signed authorization query from /login and /oauth/consent.
export const authClient = createAuthClient({ plugins: [oauthProviderClient()] });
