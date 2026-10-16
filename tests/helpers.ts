import { SqliteRepository } from "../src/server/sqlite";
import { user, installation, account } from "../src/server/schema";
import { eq } from "drizzle-orm";
import { createProjectAuth } from "../src/server/auth";
import { repository } from "../src/server";
import { session } from "../src/server/schema";
import { serializeSignedCookie } from "better-call";
import { randomUUID } from "node:crypto";
export const actor = { id: "test-admin" };
export async function addUser(
  repo: SqliteRepository,
  id: string,
  role: "admin" | "member" = "member",
) {
  await repo.store.ready;
  await repo.store.db
    .insert(user)
    .values({
      id,
      name: id,
      email: `${id}@example.com`,
      emailVerified: true,
      role,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  await repo.store.db
    .insert(account)
    .values({
      id: `account-${id}`,
      userId: id,
      providerId: "google",
      accountId: id,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  return { id };
}
export async function createRepository(path = ":memory:", _seed = false) {
  const repo = new SqliteRepository(path);
  await repo.store.ready;
  const existing = await repo.store.db
    .select()
    .from(user)
    .where(eq(user.id, actor.id));
  if (!existing.length) {
    await addUser(repo, actor.id, "admin");
    await repo.store.db
      .update(installation)
      .set({ adminId: actor.id, onboardingStep: 2 })
      .where(eq(installation.id, 1));
  }
  return repo;
}
export const authConfig = {
  BETTER_AUTH_SECRET:
    "79ec85f3c36b416dac455b48618cff9c3d1f6bf83e7974ac067b0e74d0bd5b23",
  BETTER_AUTH_URL: "http://localhost:5010",
  GOOGLE_CLIENT_ID: "test-google",
  GOOGLE_CLIENT_SECRET: "test-secret",
  GITHUB_CLIENT_ID: "test-github",
  GITHUB_CLIENT_SECRET: "test-secret",
};
export async function authenticatedRequest(
  url: string,
  init?: RequestInit,
  userId = actor.id,
) {
  const token = randomUUID(),
    now = new Date();
  await repository()
    .store.db.insert(session)
    .values({
      id: randomUUID(),
      token,
      userId,
      expiresAt: new Date(Date.now() + 86400000),
      createdAt: now,
      updatedAt: now,
    });
  const cookie = await serializeSignedCookie(
    "better-auth.session_token",
    token,
    authConfig.BETTER_AUTH_SECRET,
    { path: "/" },
  );
  const headers = new Headers(init?.headers);
  headers.set("Cookie", cookie.split(";")[0]);
  return new Request(url, { ...init, headers });
}
export async function mockOAuth(bundle: ReturnType<typeof createProjectAuth>) {
  const ctx = await bundle.instance.$context;
  for (const provider of ctx.socialProviders as {
    id: string;
    validateAuthorizationCode: Function;
    getUserInfo: Function;
  }[]) {
    provider.validateAuthorizationCode = async ({
      code,
    }: {
      code: string;
    }) => ({ accessToken: code, scopes: ["email"] });
    provider.getUserInfo = async ({
      accessToken,
    }: {
      accessToken: string;
    }) => ({
      user: {
        id: accessToken,
        email: accessToken,
        name: "Usuario de prueba",
        emailVerified: !accessToken.startsWith("unverified"),
        image: null,
      },
      data: { id: accessToken, sub: accessToken },
    });
  }
}
export async function oauthLogin(
  bundle: ReturnType<typeof createProjectAuth>,
  provider: string,
  email: string,
  invitation?: string,
) {
  const start = await bundle.handle(
    new Request(`${authConfig.BETTER_AUTH_URL}/api/auth/sign-in/social`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: authConfig.BETTER_AUTH_URL,
      },
      body: JSON.stringify({
        provider,
        callbackURL: "/",
        errorCallbackURL: "/login",
        requestSignUp: true,
        additionalData: invitation ? { invitation } : {},
      }),
    }),
  );
  const data = await start.json();
  if (!data.url) throw new Error(JSON.stringify(data));
  const cookie = start.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const state = new URL(data.url).searchParams.get("state")!;
  return bundle.handle(
    new Request(
      `${authConfig.BETTER_AUTH_URL}/api/auth/callback/${provider}?${new URLSearchParams({ code: email, state })}`,
      { headers: { Cookie: cookie } },
    ),
  );
}
