import { test } from "node:test";
import assert from "node:assert/strict";
import { SqliteRepository } from "../src/server/sqlite";
import { createProjectAuth } from "../src/server/auth";
import { InvitationService } from "../src/server/invitations";
import { user, account, invitations } from "../src/server/schema";
import { eq } from "drizzle-orm";
import { authConfig, mockOAuth, oauthLogin } from "./helpers";

test("OAuth real de Better Auth: primer administrador, invitación obligatoria y cuenta compartida entre proveedores", async () => {
  const repo = new SqliteRepository(":memory:"),
    bundle = createProjectAuth(repo, authConfig);
  try {
    await repo.store.ready;
    await mockOAuth(bundle);
    const first = await oauthLogin(bundle, "google", "admin@example.com");
    assert.equal(first.status, 302);
    assert.equal(first.headers.get("location"), "/");
    const admin = (await repo.store.db.select().from(user))[0];
    assert.equal(admin.role, "admin");
    assert.equal((await repo.store.state()).adminId, admin.id);
    const denied = await oauthLogin(bundle, "github", "outsider@example.com");
    assert.ok(
      denied.status >= 400 ||
        denied.headers.get("location")?.includes("error="),
    );
    assert.equal((await repo.store.db.select().from(user)).length, 1);
    const invites = new InvitationService(
      repo,
      authConfig.BETTER_AUTH_SECRET,
      authConfig.BETTER_AUTH_URL,
      async () => {},
    );
    const result = await invites.create(
      { email: "member@example.com", projectIds: [] },
      { id: admin.id },
    );
    const token = new URL(result.invitation.url).pathname.split("/").pop()!;
    const accepted = await oauthLogin(
      bundle,
      "github",
      "member@example.com",
      token,
    );
    assert.equal(accepted.status, 302);
    assert.equal(accepted.headers.get("location"), "/");
    assert.equal((await repo.store.db.select().from(user)).length, 2);
    const google = await oauthLogin(bundle, "google", "member@example.com");
    assert.equal(google.headers.get("location"), "/");
    assert.equal((await repo.store.db.select().from(user)).length, 2);
    assert.equal((await repo.store.db.select().from(account)).length, 3);
    const project = await repo.execute(
      {
        type: "project.create",
        name: "Acceso por invitación posterior",
        description: "",
        icon: "🌐",
        color: "#059669",
      },
      { id: admin.id },
    );
    const later = await invites.create(
      { email: "member@example.com", projectIds: [project.createdId] },
      { id: admin.id },
    );
    const laterToken = new URL(later.invitation.url).pathname.split("/").pop()!;
    assert.equal(
      (
        await oauthLogin(bundle, "github", "member@example.com", laterToken)
      ).headers.get("location"),
      "/",
    );
    const member = (
      await repo.store.db
        .select()
        .from(user)
        .where(eq(user.email, "member@example.com"))
    )[0];
    assert.equal(
      (await repo.getWorkspace({ id: member.id })).projects.length,
      1,
    );
    const unverified = await oauthLogin(
      bundle,
      "google",
      "unverified@example.com",
    );
    assert.ok(unverified.headers.get("location")?.includes("error="));
    assert.equal((await repo.store.db.select().from(user)).length, 2);
  } finally {
    await repo.close();
  }
});

test("OAuth: altas iniciales simultáneas generan un solo administrador", async () => {
  const repo = new SqliteRepository(":memory:"),
    bundle = createProjectAuth(repo, authConfig);
  try {
    await repo.store.ready;
    await mockOAuth(bundle);
    await Promise.all([
      oauthLogin(bundle, "google", "first@example.com"),
      oauthLogin(bundle, "github", "second@example.com"),
    ]);
    const users = await repo.store.db.select().from(user);
    assert.equal(users.length, 1);
    assert.equal(users[0].role, "admin");
    assert.equal((await repo.store.state()).adminId, users[0].id);
  } finally {
    await repo.close();
  }
});

test("OAuth: correo incorrecto y fallos al crear la cuenta no consumen la invitación ni dejan usuarios incompletos", async () => {
  const repo = new SqliteRepository(":memory:"),
    bundle = createProjectAuth(repo, authConfig);
  try {
    await repo.store.ready;
    await mockOAuth(bundle);
    await oauthLogin(bundle, "google", "admin@example.com");
    const admin = (await repo.store.db.select().from(user))[0],
      service = new InvitationService(
        repo,
        authConfig.BETTER_AUTH_SECRET,
        authConfig.BETTER_AUTH_URL,
        async () => {},
      );
    const invitation = await service.create(
        { email: "invited@example.com" },
        { id: admin.id },
      ),
      token = new URL(invitation.invitation.url).pathname.split("/").pop()!;
    const mismatch = await oauthLogin(
      bundle,
      "github",
      "wrong@example.com",
      token,
    );
    assert.ok(mismatch.headers.get("location")?.includes("error="));
    assert.equal((await repo.store.db.select().from(user)).length, 1);
    repo.db.exec(
      "CREATE TRIGGER fail_account BEFORE INSERT ON account BEGIN SELECT RAISE(ABORT,'simulated account failure'); END;",
    );
    await oauthLogin(bundle, "github", "invited@example.com", token);
    assert.equal((await repo.store.db.select().from(user)).length, 1);
    assert.equal(
      (
        await repo.store.db
          .select()
          .from(invitations)
          .where(eq(invitations.id, invitation.invitation.id))
      )[0].acceptedAt,
      null,
    );
    repo.db.exec("DROP TRIGGER fail_account;");
    assert.equal(
      (
        await oauthLogin(bundle, "github", "invited@example.com", token)
      ).headers.get("location"),
      "/",
    );
    assert.equal((await repo.store.db.select().from(user)).length, 2);
  } finally {
    await repo.close();
  }
});
