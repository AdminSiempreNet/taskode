import type { Actor, CurrentUser } from "../../lib/types";
import type { Effects } from "../commands";
import type { PostgresRepository } from "../postgres";
import { MCP_SCOPES } from "./config";

// Everything a tool needs for one MCP request, resolved after the access token is verified.
export interface McpContext {
  repo: PostgresRepository;
  actor: Actor;
  user: CurrentUser;
  scopes: ReadonlySet<string>;
  clientId: string;
  effects: Effects;
  origin: string;
}
export const canWrite = (ctx: McpContext) => ctx.scopes.has(MCP_SCOPES.write);
export const canAdminister = (ctx: McpContext) =>
  ctx.user.role === "admin" && ctx.scopes.has(MCP_SCOPES.admin);
