import { randomUUID } from "node:crypto";
import { and, count, eq, gt } from "drizzle-orm";
import type { z } from "zod";
import type { CallToolResult, McpServer, ToolAnnotations } from "@modelcontextprotocol/server";
import { DomainError } from "../repository";
import * as schema from "../schema";
import { canAdminister, canWrite, type McpContext } from "./context";
import { errorStatus, toolError } from "./errors";
import { textResult } from "./format";

export type Access = "read" | "write" | "admin";
export interface ToolSpec<S extends z.ZodObject> {
  name: string;
  title: string;
  description: string;
  access: Access;
  input: S;
  annotations?: Omit<ToolAnnotations, "title">;
  // Identifies the target in the audit log (never its content).
  target?: (args: z.infer<S>) => { type: string; id?: string | null } | undefined;
  run: (args: z.infer<S>) => Promise<CallToolResult | string>;
}
export const WRITE_LIMIT_PER_MINUTE = 60;
export const READ_LIMIT_PER_MINUTE = 300;
const reads = new Map<string, number[]>();
function allowRead(userId: string, now = Date.now()) {
  const recent = (reads.get(userId) ?? []).filter((at) => now - at < 60_000);
  recent.push(now);
  reads.set(userId, recent);
  if (reads.size > 10_000) reads.clear();
  return recent.length <= READ_LIMIT_PER_MINUTE;
}
async function allowWrite(ctx: McpContext) {
  const [row] = await ctx.repo.store.db
    .select({ total: count() })
    .from(schema.mcpActivity)
    .where(
      and(
        eq(schema.mcpActivity.userId, ctx.actor.id),
        gt(schema.mcpActivity.createdAt, new Date(Date.now() - 60_000)),
      ),
    );
  return (row?.total ?? 0) < WRITE_LIMIT_PER_MINUTE;
}
async function audit(
  ctx: McpContext,
  tool: string,
  outcome: "ok" | "error" | "denied",
  target?: { type: string; id?: string | null },
) {
  try {
    await ctx.repo.store.transaction(() =>
      ctx.repo.store.db.insert(schema.mcpActivity).values({
        id: randomUUID(),
        userId: ctx.actor.id,
        clientId: ctx.clientId,
        tool,
        targetType: target?.type ?? null,
        targetId: target?.id ?? null,
        outcome,
      }),
    );
  } catch (error) {
    console.error("[mcp] audit failed", error);
  }
}
// Registers a tool only when the token and the account can use it, and wraps every call
// with the same checks: scope, administrator role, rate limit, audit and error mapping.
export function defineTool<S extends z.ZodObject>(
  server: McpServer,
  ctx: McpContext,
  spec: ToolSpec<S>,
) {
  if (spec.access === "write" && !canWrite(ctx)) return;
  if (spec.access === "admin" && !canAdminister(ctx)) return;
  server.registerTool(
    spec.name,
    {
      title: spec.title,
      description: spec.description,
      inputSchema: spec.input,
      annotations: {
        title: spec.title,
        readOnlyHint: spec.access === "read",
        openWorldHint: false,
        ...spec.annotations,
      },
    },
    (async (args: z.infer<S>) => {
      const started = Date.now();
      const mutating = spec.access !== "read";
      let target: { type: string; id?: string | null } | undefined;
      try {
        target = spec.target?.(args);
      } catch {}
      try {
        if (!mutating && !allowRead(ctx.actor.id))
          throw new DomainError("Has superado el límite de consultas por minuto.", 429);
        if (mutating && !(await allowWrite(ctx)))
          throw new DomainError("Has superado el límite de cambios por minuto.", 429);
        if (spec.access === "admin") await ctx.repo.requireAdmin(ctx.actor);
        const output = await spec.run(args);
        if (mutating) await audit(ctx, spec.name, "ok", target);
        log(ctx, spec.name, true, started);
        return typeof output === "string" ? textResult(output) : output;
      } catch (error) {
        const status = errorStatus(error);
        if (mutating) await audit(ctx, spec.name, status === 403 || status === 429 ? "denied" : "error", target);
        log(ctx, spec.name, false, started);
        return toolError(error);
      }
    }) as never,
  );
}
function log(ctx: McpContext, tool: string, ok: boolean, started: number) {
  if (process.env.NODE_ENV !== "production") return;
  console.info(
    JSON.stringify({ event: "mcp.tool", tool, ok, ms: Date.now() - started, userId: ctx.actor.id, clientId: ctx.clientId }),
  );
}
