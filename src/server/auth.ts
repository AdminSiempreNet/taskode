import { AsyncLocalStorage } from "node:async_hooks";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import type { DBAdapter } from "@better-auth/core/db/adapter";
import { APIError, getOAuthState } from "better-auth/api";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import { repository } from "./index";
import type { PostgresRepository } from "./postgres";
import { InvitationService } from "./invitations";
import { isDomainError } from "./repository";
import * as schema from "./schema";

type Admission = { verifiedEmail?: string; invitation?: string };
export function providersConfigured() {
  return {
    google: Boolean(
      process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
    ),
    github: Boolean(
      process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET,
    ),
  };
}
export function authConfigured() {
  return Boolean(
    process.env.BETTER_AUTH_SECRET &&
      Object.values(providersConfigured()).some(Boolean),
  );
}
export function invitationService(repo = repository()) {
  return new InvitationService(
    repo,
    process.env.BETTER_AUTH_SECRET || "",
    process.env.BETTER_AUTH_URL || "http://localhost:5010",
  );
}

export function createProjectAuth(
  repo: PostgresRepository,
  config: Record<string, string | undefined> = process.env,
) {
  const context = new AsyncLocalStorage<Admission>();
  const invites = new InvitationService(
    repo,
    config.BETTER_AUTH_SECRET!,
    config.BETTER_AUTH_URL || "http://localhost:5010",
  );
  // All adapter operations inside Better Auth transactions share the application's
  // transaction. Admission, account creation and invitation consumption commit together.
  const rawAdapter = (options: BetterAuthOptions): DBAdapter => {
    const base = drizzleAdapter(repo.store.db, { provider: "pg", schema })(
      options,
    );
    return {
      ...base,
      transaction: (cb) => repo.store.transaction(() => cb(adapter(options))),
      create: async <T extends Record<string, unknown>, R = T>(params: {
        model: string;
        data: Omit<T, "id">;
        select?: string[];
        forceAllowId?: boolean;
      }): Promise<R> => {
        if (params.model !== "user") return base.create<T, R>(params);
        try {
          return await repo.store.transaction(async () => {
            const proof = context.getStore(),
              email = String(params.data.email).trim().toLowerCase();
            if (
              proof?.verifiedEmail !== email ||
              params.data.emailVerified !== true
            )
              throw new APIError("FORBIDDEN", {
                code: "VERIFIED_EMAIL_REQUIRED",
                message:
                  "Se requiere una identidad OAuth con correo verificado.",
              });
            const state = await repo.store.state();
            if (state.adminId && !proof.invitation)
              throw new APIError("FORBIDDEN", {
                code: "INVITATION_REQUIRED",
                message: "Necesitas una invitación para registrarte.",
              });
            if (state.adminId) await invites.verify(proof.invitation!, email);
            const created = await drizzleAdapter(repo.store.db, {
              provider: "pg",
              schema,
            })(options).create<T, R>({
              ...params,
              data: {
                ...params.data,
                email,
                role: state.adminId ? "member" : "admin",
              },
            });
            const id = String(
              (created as unknown as Record<string, unknown>).id,
            );
            if (!state.adminId)
              await repo.store.db
                .update(schema.installation)
                .set({ adminId: id })
                .where(eq(schema.installation.id, 1));
            else await invites.consume(proof.invitation!, id, email);
            return created;
          });
        } catch (error) {
          if (isDomainError(error))
            throw new APIError("FORBIDDEN", {
              code: "INVITATION_INVALID",
              message: error.message,
            });
          throw error;
        }
      },
    };
  };
  const adapter = (options: BetterAuthOptions): DBAdapter => {
    const base = rawAdapter(options);
    const writes = new Set([
      "create",
      "update",
      "updateMany",
      "delete",
      "deleteMany",
    ]);
    return new Proxy(base, {
      get(target, property) {
        const value = Reflect.get(target, property);
        if (
          typeof property !== "string" ||
          !writes.has(property) ||
          typeof value !== "function"
        )
          return value;
        return (...args: unknown[]) =>
          repo.store.transaction(async () => {
            const current = rawAdapter(options);
            return Reflect.apply(Reflect.get(current, property), current, args);
          });
      },
    });
  };
  const instance = betterAuth({
    appName: "Taskode",
    baseURL: config.BETTER_AUTH_URL || "http://localhost:5010",
    secret: config.BETTER_AUTH_SECRET,
    database: adapter,
    trustedOrigins: [config.BETTER_AUTH_URL || "http://localhost:5010"],
    emailAndPassword: { enabled: false },
    socialProviders: {
      ...(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: config.GOOGLE_CLIENT_ID,
              clientSecret: config.GOOGLE_CLIENT_SECRET,
              disableImplicitSignUp: true,
              prompt: "select_account" as const,
            },
          }
        : {}),
      ...(config.GITHUB_CLIENT_ID && config.GITHUB_CLIENT_SECRET
        ? {
            github: {
              clientId: config.GITHUB_CLIENT_ID,
              clientSecret: config.GITHUB_CLIENT_SECRET,
              disableImplicitSignUp: true,
              scope: ["read:user", "user:email"],
            },
          }
        : {}),
    },
    user: {
      additionalFields: {
        role: { type: "string", defaultValue: "member", input: false },
      },
      validateUserInfo: ({ user, source }) => {
        if (
          !source.oauth ||
          !["google", "github"].includes(source.oauth.providerId) ||
          !user.emailVerified ||
          !user.email
        )
          return {
            error: "verified_email_required",
            errorDescription: "La cuenta debe tener un correo verificado.",
          };
        const current = context.getStore();
        if (current) current.verifiedEmail = user.email.trim().toLowerCase();
      },
    },
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ["google", "github"],
        allowDifferentEmails: false,
      },
    },
    session: { cookieCache: { enabled: false } },
    databaseHooks: {
      session: {
        create: {
          before: async (data) => {
            const state = await getOAuthState<{ invitation?: string }>();
            if (state?.invitation)
              await repo.store.transaction(async () => {
                const target = (
                  await repo.store.db
                    .select()
                    .from(schema.user)
                    .where(eq(schema.user.id, data.userId))
                )[0];
                if (!target)
                  throw new APIError("FORBIDDEN", {
                    message: "La cuenta no tiene acceso.",
                  });
                const [id] = state.invitation!.split(".");
                const previous = (
                  await repo.store.db
                    .select()
                    .from(schema.invitations)
                    .where(eq(schema.invitations.id, id))
                )[0];
                if (previous?.acceptedBy === target.id && previous.acceptedAt)
                  return;
                try {
                  await invites.consume(
                    state.invitation!,
                    target.id,
                    context.getStore()?.verifiedEmail || "",
                  );
                } catch (error) {
                  if (isDomainError(error))
                    throw new APIError("FORBIDDEN", {
                      code: "INVITATION_INVALID",
                      message: error.message,
                    });
                  throw error;
                }
              });
          },
        },
      },
      user: {
        create: {
          before: async () => {
            const state = await getOAuthState<{ invitation?: string }>();
            const current = context.getStore();
            if (current) current.invitation = state?.invitation;
          },
        },
        update: {
          before: async (data, ctx) => {
            // Identity fields belong to the provider. The profile UI is read-only.
            if (ctx?.path === "/update-user")
              throw new APIError("FORBIDDEN", {
                message: "Gestiona los datos del perfil desde tu proveedor.",
              });
            if ("role" in data)
              throw new APIError("FORBIDDEN", {
                message: "El rol se administra exclusivamente en el servidor.",
              });
          },
        },
      },
    },
  });
  return {
    instance,
    handle: async (request: Request) => {
      await repo.store.ready;
      return context.run({}, () => instance.handler(request));
    },
  };
}
type AuthBundle = ReturnType<typeof createProjectAuth>;
const globalAuth = globalThis as typeof globalThis & {
  taskodeAuth?: { repo: PostgresRepository; bundle: AuthBundle };
};
export function getAuth() {
  const repo = repository();
  if (!globalAuth.taskodeAuth || globalAuth.taskodeAuth.repo !== repo)
    globalAuth.taskodeAuth = { repo, bundle: createProjectAuth(repo) };
  return globalAuth.taskodeAuth.bundle;
}
