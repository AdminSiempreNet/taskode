import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import {
  and,
  or,
  eq,
  inArray,
  isNull,
  getTableColumns,
  sql,
  type SQL,
} from "drizzle-orm";
import type { AnyPgTable } from "drizzle-orm/pg-core";
import { DatabaseStore, type DatabaseOptions } from "./database";
import {
  exportApplicationBackup,
  restoreApplicationBackup,
} from "./backup-data";
import * as schema from "./schema";
import type { Command, TrelloBoard } from "../lib/validation";
import type {
  Actor,
  CurrentUser,
  Geography,
  ImportReport,
  Workspace,
  EntityKind,
  EntityRef,
  EntityPermissions,
  EntityDetailSnapshot,
} from "../lib/types";
import { normalizeClientText } from "../lib/clients";
import { DEFAULT_TASK_TYPES, DEFAULT_IMPACTS } from "../lib/types";
import { DomainError, type WorkspaceRepository } from "./repository";
import { entityColumns, rowScope, sameEntity } from "../lib/entities";
import { NotificationsService } from "./notifications";

type Row = Record<string, string | number | boolean | string[] | null>;
async function sequential<T>(queries: (() => Promise<T>)[]): Promise<T[]> {
  const results: T[] = [];
  for (const query of queries) results.push(await query());
  return results;
}
type CommandResult = { report?: ImportReport; createdId?: string };
const defaults = [
  { name: "Pendiente", color: "#64748b", done: false },
  { name: "En proceso", color: "#3b82f6", done: false },
  { name: "En revisión", color: "#f59e0b", done: false },
  { name: "Terminado", color: "#059669", done: true },
];
async function each<T>(
  items: T[],
  fn: (item: T, index: number) => Promise<unknown>,
) {
  for (let index = 0; index < items.length; index++)
    await fn(items[index], index);
}
export class PostgresRepository implements WorkspaceRepository {
  // Incrementar al cambiar el contrato o las migraciones de una instancia cacheada.
  static readonly cacheVersion = 16;
  readonly cacheVersion = PostgresRepository.cacheVersion;
  readonly store: DatabaseStore;
  readonly notifications: NotificationsService;
  private actorContext = new AsyncLocalStorage<Actor>();
  constructor(connectionString: string, options: DatabaseOptions = {}) {
    this.store = new DatabaseStore(connectionString, options);
    this.notifications = new NotificationsService(this);
  }
  private table(name: string): AnyPgTable {
    const table = schema.domainTables[name as keyof typeof schema.domainTables];
    if (!table) throw new Error("Tabla de dominio desconocida.");
    return table;
  }
  private condition(
    table: AnyPgTable,
    fields: Row,
    insensitive: string[] = [],
  ): SQL | undefined {
    const columns = getTableColumns(table);
    return and(
      ...Object.entries(fields).map(([key, value]) => {
        if (!columns[key]) throw new Error("Columna de dominio desconocida.");
        return value === null
          ? isNull(columns[key])
          : insensitive.includes(key)
            ? sql`lower(${columns[key]}) = lower(${value})`
            : eq(columns[key], value);
      }),
    );
  }
  private async find(
    name: string,
    fields: Row = {},
    insensitive: string[] = [],
    preferMedium = false,
  ): Promise<Row[]> {
    await this.store.ready;
    const table = this.table(name);
    const rows = (await this.store.db
      .select()
      .from(table)
      .where(this.condition(table, fields, insensitive))) as Row[];
    if (preferMedium)
      rows.sort(
        (a, b) =>
          Number(b.id === "medium") - Number(a.id === "medium") ||
          Number(a.position) - Number(b.position),
      );
    return rows;
  }
  private async all(name: string): Promise<Row[]> {
    const rows = await this.find(name);
    return rows.sort((a, b) =>
      name === "projects" || name === "comments"
        ? String(a.createdAt).localeCompare(String(b.createdAt)) ||
          String(a.id).localeCompare(String(b.id))
        : name === "task_status_history"
          ? Number(b.id) - Number(a.id)
          : Number(a.position) - Number(b.position) ||
            String(a.id).localeCompare(String(b.id)),
    );
  }
  private async get(name: string, id: string): Promise<Row> {
    const row = (await this.find(name, { id }))[0];
    if (!row)
      throw new DomainError(
        "El elemento ya no existe o no tienes acceso.",
        404,
      );
    return row;
  }
  private async insert(name: string, row: Row) {
    await this.store.db.insert(this.table(name)).values(row);
  }
  private async patchWhere(name: string, where: Row, row: Row) {
    const table = this.table(name);
    await this.store.db
      .update(table)
      .set(row)
      .where(this.condition(table, where));
  }
  private async update(name: string, id: string, row: Row) {
    await this.get(name, id);
    await this.patchWhere(name, { id }, row);
  }
  private async remove(name: string, fields: Row) {
    const table = this.table(name);
    await this.store.db.delete(table).where(this.condition(table, fields));
  }
  private async countWhere(name: string, fields: Row) {
    return { n: (await this.find(name, fields)).length };
  }
  private async positionWhere(name: string, fields: Row) {
    const n =
      Math.max(
        -1,
        ...(await this.find(name, fields)).map((row) => Number(row.position)),
      ) + 1;
    return { n, position: n };
  }
  private async nextPosition(name: string, projectId: string) {
    return (await this.positionWhere(name, { projectId })).n;
  }
  private transaction<T>(fn: () => Promise<T>) {
    return this.store.transaction(fn);
  }
  async currentUser(actor: Actor): Promise<CurrentUser> {
    await this.store.ready;
    const row = (
      await this.store.db
        .select()
        .from(schema.user)
        .where(eq(schema.user.id, actor.id))
    )[0];
    if (!row) throw new DomainError("Inicia sesión para continuar.", 401);
    const providers = (
      await this.store.db
        .select({ providerId: schema.account.providerId })
        .from(schema.account)
        .where(eq(schema.account.userId, row.id))
    ).map((x) => x.providerId);
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      image: row.image,
      role: row.role,
      createdAt: row.createdAt.toISOString(),
      providers,
    };
  }
  async requireAdmin(actor: Actor) {
    const user = await this.currentUser(actor);
    if (user.role !== "admin" || (await this.store.state()).adminId !== user.id)
      throw new DomainError(
        "Esta acción requiere permisos de administrador.",
        403,
      );
    return user;
  }
  async requireProject(actor: Actor, projectId: string, manage = false) {
    const user = await this.currentUser(actor),
      project = await this.get("projects", projectId);
    if (user.role === "admin" || project.leaderId === user.id) return project;
    const member = (
      await this.store.db
        .select()
        .from(schema.projectTeamMembers)
        .where(
          and(
            eq(schema.projectTeamMembers.projectId, projectId),
            eq(schema.projectTeamMembers.userId, user.id),
          ),
        )
    )[0];
    if (!member)
      throw new DomainError("El proyecto no existe o no tienes acceso.", 404);
    if (manage)
      throw new DomainError(
        "Solo el líder o el administrador puede realizar esta acción.",
        403,
      );
    return project;
  }
  taskVisibility(actor: Actor) {
    return or(
      eq(schema.tasks.leaderId, actor.id),
      sql`exists (select 1 from ${schema.taskTeamMembers} c where c."taskId" = ${schema.tasks.id} and c."userId" = ${actor.id})`,
      sql`exists (select 1 from ${schema.projects} p where p.id = ${schema.tasks.projectId} and p."leaderId" = ${actor.id})`,
      sql`exists (select 1 from ${schema.features} f left join ${schema.modules} m on m.id = f."moduleId" where f.id = ${schema.tasks.featureId} and (f."leaderId" = ${actor.id} or m."leaderId" = ${actor.id}))`,
    );
  }
  async requireScope(actor: Actor, kind: "modules" | "features", id: string) {
    const row = await this.get(kind, id);
    const project = await this.requireProject(actor, String(row.projectId));
    const user = await this.currentUser(actor);
    const parent =
      kind === "features" && row.moduleId
        ? await this.get("modules", String(row.moduleId))
        : null;
    if (
      user.role !== "admin" &&
      project.leaderId !== actor.id &&
      row.leaderId !== actor.id &&
      parent?.leaderId !== actor.id
    )
      throw new DomainError(
        "Solo el líder o un líder superior puede realizar esta acción.",
        403,
      );
    return row;
  }
  async requireParticipant(projectId: string, userId: string) {
    await this.requireProject({ id: userId }, projectId);
  }
  async projectPeople(actor: Actor, projectId: string) {
    const project = await this.requireProject(actor, projectId);
    const members = await this.store.db
      .select()
      .from(schema.projectTeamMembers)
      .where(eq(schema.projectTeamMembers.projectId, projectId));
    return this.store.db
      .select({
        id: schema.user.id,
        name: schema.user.name,
        email: schema.user.email,
        image: schema.user.image,
      })
      .from(schema.user)
      .where(
        or(
          eq(schema.user.id, String(project.leaderId)),
          eq(schema.user.role, "admin"),
          inArray(
            schema.user.id,
            members.map((m) => m.userId),
          ),
        ),
      );
  }
  async requireTask(actor: Actor, id: string) {
    const task = await this.get("tasks", id);
    const project = await this.requireProject(actor, String(task.projectId));
    const user = await this.currentUser(actor);
    const feature = await this.get("features", String(task.featureId));
    const module = feature.moduleId
      ? await this.get("modules", String(feature.moduleId))
      : null;
    const manager =
      user.role === "admin" ||
      project.leaderId === actor.id ||
      feature.leaderId === actor.id ||
      module?.leaderId === actor.id ||
      task.leaderId === actor.id;
    const teamMember =
      manager ||
      (await this.find("task_team_members", { taskId: id, userId: actor.id }))
        .length > 0;
    if (!teamMember)
      throw new DomainError("La tarea no existe o no tienes acceso.", 404);
    return {
      task,
      permissions: {
        canEdit: true,
        canManageAccess: manager,
        canDelete: manager,
        canModerateComments: manager,
      },
    };
  }
  async requireEntity(
    actor: Actor,
    kind: EntityKind,
    id: string,
    expectedProject?: string,
  ) {
    const table = {
      project: "projects",
      module: "modules",
      feature: "features",
      task: "tasks",
    }[kind];
    const entity = await this.get(table, id);
    const projectId = String(kind === "project" ? entity.id : entity.projectId);
    if (expectedProject && expectedProject !== projectId)
      throw new DomainError("El elemento no pertenece a este proyecto.", 404);
    const project = await this.requireProject(actor, projectId);
    const user = await this.currentUser(actor);
    const parent =
      kind === "feature" && entity.moduleId
        ? await this.get("modules", String(entity.moduleId))
        : null;
    const manager =
      user.role === "admin" ||
      project.leaderId === actor.id ||
      (kind !== "project" && entity.leaderId === actor.id) ||
      parent?.leaderId === actor.id;
    const taskPermissions =
      kind === "task" ? (await this.requireTask(actor, id)).permissions : null;
    const teamMember =
      (kind === "module" || kind === "feature") &&
      (
        await this.find(`${kind}_team_members`, {
          [`${kind}Id`]: id,
          userId: actor.id,
        })
      ).length > 0;
    const permissions: EntityPermissions = {
      canEdit: manager || teamMember,
      canDelete: manager,
      canManageAccess: manager,
      canModerateComments: manager,
      ...taskPermissions,
      canComment: true,
      canManageFiles: taskPermissions?.canEdit ?? (manager || teamMember),
    };
    return {
      scope: { kind, id, projectId } satisfies EntityRef,
      entity,
      permissions,
    };
  }
  async entityDetail(
    actor: Actor,
    kind: EntityKind,
    id: string,
    projectId?: string,
  ): Promise<EntityDetailSnapshot> {
    return this.store.snapshot(async () => {
      const detail = await this.requireEntity(actor, kind, id, projectId);
      const files = (
        await this.find("files", {
          ...entityColumns(detail.scope),
          status: "ready",
        })
      ).map(
        ({ storageKey: _key, uploadedBy: _by, status: _status, ...file }) =>
          file,
      );
      const teamMemberIds = (
        await this.find(`${kind}_team_members`, { [`${kind}Id`]: id })
      ).map((m) => String(m.userId));
      return {
        ...detail,
        entity: { ...detail.entity, teamMemberIds },
        files,
      } as unknown as EntityDetailSnapshot;
    });
  }
  private async commentScope(command: Command): Promise<EntityRef> {
    if (command.type === "comment.create") {
      if (command.scope && !command.taskId) return command.scope;
      if (command.taskId && !command.scope) {
        const task = await this.get("tasks", command.taskId);
        return {
          kind: "task",
          id: command.taskId,
          projectId: String(task.projectId),
        };
      }
      throw new DomainError("Indica un único destino para el comentario.");
    }
    if (command.type === "comment.update" || command.type === "comment.delete")
      return rowScope(
        (await this.get("comments", command.id)) as Parameters<
          typeof rowScope
        >[0],
      )!;
    throw new DomainError("Operación de comentario inválida.");
  }
  async entityComments(actor: Actor, kind: EntityKind, id: string) {
    return this.store.snapshot(async () => {
      const { permissions, scope } = await this.requireEntity(actor, kind, id);
      const comments = await this.find("comments", entityColumns(scope));
      const authorIds = [
        ...new Set(
          comments
            .map((c) => c.authorId)
            .filter((id): id is string => typeof id === "string"),
        ),
      ];
      const users = authorIds.length
        ? await this.store.db
            .select({
              id: schema.user.id,
              name: schema.user.name,
              image: schema.user.image,
            })
            .from(schema.user)
            .where(inArray(schema.user.id, authorIds))
        : [];
      return {
        permissions,
        comments: comments
          .sort(
            (a, b) =>
              String(a.createdAt).localeCompare(String(b.createdAt)) ||
              String(a.id).localeCompare(String(b.id)),
          )
          .map((c) => ({
            id: String(c.id),
            taskId: c.taskId === null ? null : String(c.taskId),
            content: String(c.content),
            createdAt: String(c.createdAt),
            updatedAt: String(c.updatedAt),
            authorId: c.authorId === null ? null : String(c.authorId),
            scope,
            author: users.find((u) => u.id === c.authorId) ?? null,
            canEdit: c.authorId === actor.id,
            canDelete:
              c.authorId === actor.id || permissions.canModerateComments,
          })),
      };
    });
  }
  async taskComments(actor: Actor, id: string) {
    return this.entityComments(actor, "task", id);
  }
  async executeEntityComment(
    actor: Actor,
    kind: EntityKind,
    id: string,
    command: Command,
  ) {
    return this.transaction(async () => {
      const { scope } = await this.requireEntity(actor, kind, id);
      if (!sameEntity(scope, await this.commentScope(command)))
        throw new DomainError(
          "El comentario no pertenece a este elemento.",
          404,
        );
      const result = await this.execute(command, actor);
      return { ...result, ...(await this.entityComments(actor, kind, id)) };
    });
  }
  async executeComment(actor: Actor, taskId: string, command: Command) {
    return this.executeEntityComment(actor, "task", taskId, command);
  }
  async commentRecipients(
    taskId: string,
    kind: EntityKind = "task",
  ): Promise<string[]> {
    return this.store.snapshot(async () => {
      if (kind !== "task") {
        const table = {
          project: "projects",
          module: "modules",
          feature: "features",
        }[kind];
        const entity = (await this.find(table, { id: taskId }))[0];
        if (!entity) return [];
        const projectId = String(
          kind === "project" ? entity.id : entity.projectId,
        );
        const project = await this.get("projects", projectId);
        const members = await this.findProjectMemberIds(projectId);
        const users = await this.store.db
          .select({ id: schema.user.id })
          .from(schema.user)
          .where(
            or(
              eq(schema.user.role, "admin"),
              inArray(schema.user.id, [String(project.leaderId), ...members]),
            ),
          );
        return users.map((u) => u.id);
      }
      const task = (await this.find("tasks", { id: taskId }))[0];
      if (!task) return [];
      const project = await this.get("projects", String(task.projectId));
      const feature = await this.get("features", String(task.featureId));
      const module = feature.moduleId
        ? await this.get("modules", String(feature.moduleId))
        : null;
      const owners = [
        project.leaderId,
        feature.leaderId,
        module?.leaderId,
        task.leaderId,
      ].filter((id): id is string => typeof id === "string");
      const users = await this.store.db
        .select({ id: schema.user.id })
        .from(schema.user)
        .where(
          or(
            eq(schema.user.role, "admin"),
            and(
              or(
                eq(schema.user.id, String(project.leaderId)),
                sql`exists (select 1 from ${schema.projectTeamMembers} pm where pm."projectId" = ${task.projectId} and pm."userId" = ${schema.user.id})`,
              ),
              or(
                inArray(schema.user.id, owners),
                sql`exists (select 1 from ${schema.taskTeamMembers} tm where tm."taskId" = ${taskId} and tm."userId" = ${schema.user.id})`,
              ),
            ),
          ),
        );
      return users.map((user) => user.id);
    });
  }
  private async findProjectMemberIds(projectId: string) {
    return (
      await this.store.db
        .select({ id: schema.projectTeamMembers.userId })
        .from(schema.projectTeamMembers)
        .where(eq(schema.projectTeamMembers.projectId, projectId))
    ).map((m) => m.id);
  }
  private async setTaskAssignment(
    id: string,
    projectId: string,
    leaderId: string,
    teamMembers: string[],
  ) {
    for (const userId of new Set([leaderId, ...teamMembers]))
      await this.requireParticipant(projectId, userId);
    await this.update("tasks", id, {
      leaderId,
      updatedAt: new Date().toISOString(),
    });
    await this.remove("task_team_members", { taskId: id });
    for (const userId of new Set(teamMembers.filter((x) => x !== leaderId)))
      await this.insert("task_team_members", { taskId: id, userId });
  }
  async bindContentFiles(
    content: string,
    actor: Actor,
    projectId: string,
    taskId: string | EntityRef,
  ) {
    const scope: EntityRef =
      typeof taskId === "string"
        ? { kind: "task", id: taskId, projectId }
        : taskId;
    if (/!\[[^\]]*\]\(\s*(?:data:|blob:)/i.test(content))
      throw new DomainError(
        "Carga la imagen al almacenamiento antes de guardar.",
      );
    const ids = [
      ...content.matchAll(/\/api\/files\/([a-f0-9-]{36})\/content/g),
    ].map((m) => m[1]);
    for (const id of new Set(ids)) {
      const file = await this.get("files", id);
      if (
        file.projectId !== projectId ||
        file.status !== "ready" ||
        (file.scopeType === null &&
          Date.parse(String(file.createdAt)) < Date.now() - 86400000) ||
        (!sameEntity(rowScope(file as Parameters<typeof rowScope>[0]), scope) &&
          (file.scopeType !== null || file.uploadedBy !== actor.id))
      )
        throw new DomainError(
          "La imagen no pertenece a esta tarea o no terminó de cargar.",
          403,
        );
      if (file.scopeType === null) {
        if (
          file.purpose === "file" &&
          !(
            await this.requireEntity(
              actor,
              scope.kind,
              scope.id,
              scope.projectId,
            )
          ).permissions.canManageFiles
        )
          throw new DomainError(
            "No puedes gestionar los archivos de este elemento.",
            403,
          );
        await this.update("files", id, entityColumns(scope));
      }
    }
  }
  private async authorize(command: Command, actor: Actor) {
    await this.currentUser(actor);
    const c = command;
    if (c.type.startsWith("comment.")) {
      const scope = await this.commentScope(c);
      const { permissions } = await this.requireEntity(
        actor,
        scope.kind,
        scope.id,
        scope.projectId,
      );
      if (c.type === "comment.update" || c.type === "comment.delete") {
        const comment = await this.get("comments", c.id);
        if (
          comment.authorId !== actor.id &&
          !(c.type === "comment.delete" && permissions.canModerateComments)
        )
          throw new DomainError(
            "Solo puedes editar tus propios comentarios.",
            403,
          );
      }
      return;
    }
    if (c.type === "settings.update") {
      await this.requireAdmin(actor);
      return;
    }
    if (
      (c.type.startsWith("task.") && c.type !== "task.create") ||
      c.type.startsWith("checklist.")
    ) {
      let taskId: string;
      if ("taskId" in c && c.taskId) taskId = c.taskId;
      else if ("checklistId" in c)
        taskId = String((await this.get("checklists", c.checklistId)).taskId);
      else {
        const entry = c as { id: string };
        if (c.type.startsWith("task.")) taskId = entry.id;
        else if (c.type.startsWith("checklist.item.")) {
          const item = await this.get("checklist_items", entry.id);
          taskId = String(
            (await this.get("checklists", String(item.checklistId))).taskId,
          );
        } else taskId = String((await this.get("checklists", entry.id)).taskId);
      }
      const { task, permissions } = await this.requireTask(actor, taskId);
      if (
        (c.type === "task.delete" ||
          c.type === "task.assignment.update" ||
          (c.type === "task.update" && c.featureId !== task.featureId)) &&
        !permissions.canManageAccess
      )
        throw new DomainError(
          "Solo el líder o un líder superior puede realizar esta acción.",
          403,
        );
      if (c.type === "task.move" && c.beforeId) {
        const target = await this.requireTask(actor, c.beforeId);
        if (target.task.projectId !== task.projectId)
          throw new DomainError("La tarea pertenece a otro proyecto.");
      }
      return;
    }
    if (/^(module|feature)\./.test(c.type) && !c.type.endsWith(".create")) {
      const kind = c.type.startsWith("module.") ? "modules" : "features";
      if (c.type.endsWith(".reorder"))
        await this.requireProject(
          actor,
          (c as { projectId: string }).projectId,
          true,
        );
      else if (
        c.type === "module.rename" ||
        c.type === "module.update" ||
        c.type === "feature.rename" ||
        c.type === "feature.update"
      ) {
        const detail = await this.requireEntity(
          actor,
          kind === "modules" ? "module" : "feature",
          c.id,
        );
        if (
          !detail.permissions.canEdit ||
          (c.type === "feature.update" &&
            (c.moduleId ?? null) !== detail.entity.moduleId &&
            !detail.permissions.canManageAccess)
        )
          throw new DomainError(
            "Solo los líderes pueden mover elementos o gestionar su acceso.",
            403,
          );
      } else await this.requireScope(actor, kind, (c as { id: string }).id);
      return;
    }
    if (c.type.startsWith("client.")) return;
    if (
      c.type === "project.create" ||
      (c.type === "trello.import" && c.projectId === null)
    )
      return;
    if (c.type === "project.leader.update") {
      await this.requireAdmin(actor);
      await this.requireProject(actor, c.id, true);
      return;
    }
    let projectId: string;
    if ("projectId" in c && c.projectId) projectId = c.projectId;
    else {
      let table = c.type.startsWith("checklist.item.")
        ? "checklist_items"
        : (
            {
              project: "projects",
              module: "modules",
              feature: "features",
              status: "statuses",
              task: "tasks",
              checklist: "checklists",
              comment: "comments",
            } as Record<string, string>
          )[c.type.split(".")[0]];
      let row: Row;
      if ("taskId" in c && c.taskId) {
        table = "tasks";
        row = await this.get(table, c.taskId);
      } else if ("checklistId" in c) {
        table = "checklists";
        row = await this.get(table, c.checklistId);
      } else row = await this.get(table, (c as { id: string }).id);
      if (table === "checklist_items") {
        row = await this.get("checklists", String(row.checklistId));
        table = "checklists";
      }
      if (table === "checklists" || table === "comments")
        row = await this.get("tasks", String(row.taskId));
      projectId = String(table === "projects" ? row.id : row.projectId);
    }
    const manage =
      /^(project\.|status\.|priority\.|taskType\.|impact\.|label\.|trello\.)/.test(
        c.type,
      );
    await this.requireProject(actor, projectId, manage);
  }
  private async setEntityAssignment(
    actor: Actor,
    kind: "project" | "module" | "feature",
    id: string,
    leaderId: string,
    teamMemberIds: string[],
  ) {
    const detail = await this.requireEntity(actor, kind, id);
    if (!detail.permissions.canManageAccess)
      throw new DomainError("Solo los líderes pueden gestionar usuarios.", 403);
    const next = [...new Set(teamMemberIds)].filter(
      (userId) => userId !== leaderId,
    );
    if (kind === "project") {
      if (leaderId !== detail.entity.leaderId) {
        await this.requireAdmin(actor);
        await this.accessCommand({
          type: "project.leader.update",
          id,
          userId: leaderId,
        });
        if (!next.includes(String(detail.entity.leaderId)))
          next.push(String(detail.entity.leaderId));
      }
      const current = await this.find("project_team_members", {
        projectId: id,
      });
      // Add before removing: all changes share the command transaction.
      for (const userId of next)
        await this.accessCommand({
          type: "project.team.add",
          projectId: id,
          userId,
        });
      for (const member of current)
        if (!next.includes(String(member.userId)))
          await this.accessCommand({
            type: "project.team.remove",
            projectId: id,
            userId: String(member.userId),
          });
      return;
    }
    for (const userId of [leaderId, ...next])
      await this.requireParticipant(detail.scope.projectId, userId);
    await this.update(kind === "module" ? "modules" : "features", id, {
      leaderId,
    });
    await this.remove(`${kind}_team_members`, { [`${kind}Id`]: id });
    for (const userId of next)
      await this.insert(`${kind}_team_members`, { [`${kind}Id`]: id, userId });
  }
  private async accessCommand(command: Command): Promise<boolean> {
    const c = command;
    if (c.type === "project.leader.update") {
      if (
        !(
          await this.store.db
            .select({ id: schema.user.id })
            .from(schema.user)
            .where(eq(schema.user.id, c.userId))
        ).length
      )
        throw new DomainError("El usuario no existe.", 404);
      const old = await this.get("projects", c.id);
      await this.store.db
        .insert(schema.projectTeamMembers)
        .values({ projectId: c.id, userId: String(old.leaderId) })
        .onConflictDoNothing();
      await this.update("projects", c.id, { leaderId: c.userId });
      await this.store.db
        .delete(schema.projectTeamMembers)
        .where(
          and(
            eq(schema.projectTeamMembers.projectId, c.id),
            eq(schema.projectTeamMembers.userId, c.userId),
          ),
        );
      return true;
    }
    if (c.type === "project.team.add" || c.type === "project.team.remove") {
      if (
        !(
          await this.store.db
            .select({ id: schema.user.id })
            .from(schema.user)
            .where(eq(schema.user.id, c.userId))
        ).length
      )
        throw new DomainError("El usuario no existe.", 404);
      const project = await this.get("projects", c.projectId);
      if (project.leaderId === c.userId)
        throw new DomainError("El líder ya tiene acceso al proyecto.");
      if (c.type === "project.team.add")
        await this.store.db
          .insert(schema.projectTeamMembers)
          .values({ projectId: c.projectId, userId: c.userId })
          .onConflictDoNothing();
      else {
        const owned = await this.store.db
          .select({ id: schema.tasks.id })
          .from(schema.tasks)
          .where(
            and(
              eq(schema.tasks.projectId, c.projectId),
              eq(schema.tasks.leaderId, c.userId),
            ),
          )
          .limit(1);
        const modules = await this.find("modules", {
          projectId: c.projectId,
          leaderId: c.userId,
        });
        const features = await this.find("features", {
          projectId: c.projectId,
          leaderId: c.userId,
        });
        if (owned.length || modules.length || features.length)
          throw new DomainError(
            "Reasigna primero las tareas, módulos y features de este usuario.",
            409,
          );
        for (const kind of ["module", "feature"] as const) {
          const elements = await this.find(
            kind === "module" ? "modules" : "features",
            { projectId: c.projectId },
          );
          for (const element of elements)
            await this.remove(`${kind}_team_members`, {
              [`${kind}Id`]: String(element.id),
              userId: c.userId,
            });
        }
        await this.store.db
          .delete(schema.taskTeamMembers)
          .where(
            and(
              eq(schema.taskTeamMembers.userId, c.userId),
              inArray(
                schema.taskTeamMembers.taskId,
                this.store.db
                  .select({ id: schema.tasks.id })
                  .from(schema.tasks)
                  .where(eq(schema.tasks.projectId, c.projectId)),
              ),
            ),
          );
        await this.store.db
          .delete(schema.projectTeamMembers)
          .where(
            and(
              eq(schema.projectTeamMembers.projectId, c.projectId),
              eq(schema.projectTeamMembers.userId, c.userId),
            ),
          );
      }
      return true;
    }
    return false;
  }
  getWorkspace(actor: Actor): Promise<Workspace> {
    return this.store.snapshot(() => this.readWorkspace(actor));
  }
  getGeography(actor: Actor): Promise<Geography> {
    return this.store.snapshot(async () => {
      await this.currentUser(actor);
      const departments = await this.store.db.select().from(schema.departments);
      const cities = await this.store.db.select().from(schema.cities);
      return {
        departments: departments.sort((a, b) =>
          a.name.localeCompare(b.name, "es"),
        ),
        cities: cities.sort((a, b) => a.name.localeCompare(b.name, "es")),
      };
    });
  }
  private async readWorkspace(actor: Actor): Promise<Workspace> {
    const currentUser = await this.currentUser(actor);
    const memberships = await this.store.db
      .select()
      .from(schema.projectTeamMembers)
      .where(eq(schema.projectTeamMembers.userId, actor.id));
    const projects = (await this.all("projects")).filter(
      (p) =>
        currentUser.role === "admin" ||
        p.leaderId === actor.id ||
        memberships.some((m) => m.projectId === p.id),
    );
    const ids = projects.map((p) => String(p.id));
    const rows = async (
      name: string,
      key = "projectId",
      values = ids,
    ): Promise<Row[]> => {
      if (!values.length) return [];
      const table = this.table(name),
        column = getTableColumns(table)[key];
      return (await this.store.db
        .select()
        .from(table)
        .where(inArray(column, values))) as Row[];
    };
    const [
      modules,
      features,
      statuses,
      priorities,
      taskTypes,
      impacts,
      labels,
      tasks,
    ] = await sequential([
      () => rows("modules"),
      () => rows("features"),
      () => rows("statuses"),
      () => rows("priorities"),
      () => rows("task_types"),
      () => rows("impacts"),
      () => rows("labels"),
      () =>
        this.store.db
          .select()
          .from(schema.tasks)
          .where(
            and(
              inArray(schema.tasks.projectId, ids),
              currentUser.role === "admin" ? undefined : this.taskVisibility(actor),
            ),
          ) as unknown as Promise<Row[]>,
    ]);
    const taskIds = tasks.map((t) => String(t.id));
    const teamMembers = await rows("task_team_members", "taskId", taskIds);
    const projectTeams = await rows("project_team_members");
    const moduleTeams = await rows(
      "module_team_members",
      "moduleId",
      modules.map((m) => String(m.id)),
    );
    const featureTeams = await rows(
      "feature_team_members",
      "featureId",
      features.map((f) => String(f.id)),
    );

    const files = (await rows("files", "taskId", taskIds)).filter(
      (f) => f.status === "ready",
    );
    const people = (
      await sequential(
        projects.map((p) => async () =>
          (await this.projectPeople(actor, String(p.id))).map((u) => ({
            ...u,
            projectId: String(p.id),
          })),
        ),
      )
    ).flat();
    const authors = await this.store.db
      .select({
        id: schema.user.id,
        name: schema.user.name,
        image: schema.user.image,
      })
      .from(schema.user);
    const managesScope = (f: Row, module = false) =>
      currentUser.role === "admin" ||
      projects.some((p) => p.id === f.projectId && p.leaderId === actor.id) ||
      f.leaderId === actor.id ||
      (!module &&
        modules.some((m) => m.id === f.moduleId && m.leaderId === actor.id));
    const associations = await rows("task_clients", "taskId", taskIds);
    const clientIdsByTask = new Map<string, string[]>();
    for (const link of associations) {
      const key = String(link.taskId);
      clientIdsByTask.set(key, [
        ...(clientIdsByTask.get(key) ?? []),
        String(link.clientId),
      ]);
    }
    const clients = await this.store.db
      .select({
        id: schema.clients.id,
        name: schema.clients.name,
        cityId: schema.clients.cityId,
        cityName: schema.cities.name,
        departmentId: schema.departments.id,
        departmentName: schema.departments.name,
        createdAt: schema.clients.createdAt,
        updatedAt: schema.clients.updatedAt,
      })
      .from(schema.clients)
      .innerJoin(schema.cities, eq(schema.clients.cityId, schema.cities.id))
      .innerJoin(
        schema.departments,
        eq(schema.cities.departmentId, schema.departments.id),
      );
    const [lists, comments, history] = await sequential([
      () => rows("checklists", "taskId", taskIds),
      () => rows("comments", "taskId", taskIds),
      () => rows("task_status_history", "taskId", taskIds),
    ]);
    const items = await rows(
      "checklist_items",
      "checklistId",
      lists.map((l) => String(l.id)),
    );
    const sort = (values: Row[]) =>
      values.sort(
        (a, b) =>
          Number(a.position) - Number(b.position) ||
          String(a.id).localeCompare(String(b.id)),
      );
    const state = await this.store.state();
    return {
      currentUser,
      onboarding: {
        step: state.onboardingStep,
        firstProjectId: state.firstProjectId,
      },
      projects: projects.map((p) => ({
        ...p,
        teamMemberIds: projectTeams
          .filter((m) => m.projectId === p.id && m.userId !== p.leaderId)
          .map((m) => String(m.userId)),
      })),
      people,
      settings: { maxAttachmentBytes: state.maxAttachmentBytes },
      modules: sort(modules).map((m) => ({
        ...m,
        canManage: managesScope(m, true),
        teamMemberIds: moduleTeams
          .filter(
            (link) => link.moduleId === m.id && link.userId !== m.leaderId,
          )
          .map((link) => String(link.userId)),
      })),
      features: sort(features).map((f) => ({
        ...f,
        pinned: Boolean(f.pinned),
        canManage: managesScope(f),
        teamMemberIds: featureTeams
          .filter(
            (link) => link.featureId === f.id && link.userId !== f.leaderId,
          )
          .map((link) => String(link.userId)),
      })),
      statuses: sort(statuses).map((s) => ({
        ...s,
        isDone: Boolean(s.isDone),
      })),
      priorities: sort(priorities),
      taskTypes: sort(taskTypes),
      impacts: sort(impacts),
      labels: sort(labels),
      clients: clients.sort(
        (a, b) =>
          a.name.localeCompare(b.name, "es") || a.id.localeCompare(b.id),
      ),
      tasks: sort(tasks).map((t) => {
        const { externalId: _, ...row } = t;
        return {
          ...row,
          teamMemberIds: teamMembers
            .filter((c) => c.taskId === t.id)
            .map((c) => String(c.userId)),
          leader: authors.find((u) => u.id === t.leaderId),
          teamMembers: authors.filter((u) =>
            teamMembers.some((c) => c.taskId === t.id && c.userId === u.id),
          ),
          permissions: {
            canEdit: true,
            canManageAccess:
              t.leaderId === actor.id ||
              managesScope(features.find((f) => f.id === t.featureId)!),
            canDelete:
              t.leaderId === actor.id ||
              managesScope(features.find((f) => f.id === t.featureId)!),
            canModerateComments:
              t.leaderId === actor.id ||
              managesScope(features.find((f) => f.id === t.featureId)!),
          },
          files: files
            .filter((f) => f.taskId === t.id)
            .map(
              ({ storageKey: _key, uploadedBy: _by, status: _status, ...f }) =>
                f,
            ),
          archived: Boolean(t.archived),
          labels: t.labels,
          clientIds: (clientIdsByTask.get(String(t.id)) ?? []).sort(),
          checklists: sort(lists.filter((l) => l.taskId === t.id)).map((l) => ({
            ...l,
            items: sort(items.filter((i) => i.checklistId === l.id)).map(
              (i) => ({ ...i, completed: Boolean(i.completed) }),
            ),
          })),
          comments: comments
            .filter((c) => c.taskId === t.id)
            .map((c) => ({
              ...c,
              id: c.id,
              createdAt: c.createdAt,
              author: authors.find((u) => u.id === c.authorId) ?? null,
              canEdit: c.authorId === actor.id,
              canDelete:
                c.authorId === actor.id ||
                t.leaderId === actor.id ||
                managesScope(features.find((f) => f.id === t.featureId)!),
            }))
            .sort(
              (a, b) =>
                String(a.createdAt).localeCompare(String(b.createdAt)) ||
                String(a.id).localeCompare(String(b.id)),
            ),
          statusHistory: history
            .filter((h) => h.taskId === t.id)
            .sort((a, b) => Number(b.id) - Number(a.id)),
        };
      }),
    } as unknown as Workspace;
  }
  exportBackup(destination: string) {
    return exportApplicationBackup(this.store, destination);
  }
  restoreBackup(source: string, beforeRestore?: () => Promise<void>) {
    return restoreApplicationBackup(this.store, source, beforeRestore);
  }
  exclusiveBackup<T>(action: () => Promise<T>) {
    return this.store.exclusiveOperation(action);
  }
  async close() {
    await this.store.close();
  }

  private async defaultPriorities(projectId: string) {
    await each(
      [
        { id: "low", name: "Baja", color: "#64748b" },
        { id: "medium", name: "Media", color: "#d97706" },
        { id: "high", name: "Alta", color: "#dc2626" },
      ],
      async (priority, position) =>
        await this.insert("priorities", { ...priority, projectId, position }),
    );
  }
  private async ensureLabels(
    projectId: string,
    names: string[],
    colors: string[] = [],
  ) {
    const trelloColors: Record<string, string> = {
      green: "#059669",
      yellow: "#d97706",
      orange: "#ea580c",
      red: "#dc2626",
      purple: "#8b5cf6",
      blue: "#3b82f6",
      sky: "#0891b2",
      lime: "#65a30d",
      pink: "#db2777",
      black: "#64748b",
    };
    return [
      ...new Set(
        await sequential(
          names.map((name, index) => async () => {
            const existing = await this.optionNamed("labels", projectId, name);
            if (existing) return String(existing.name);
            const inputColor = colors[index] ?? "";
            const color = /^#[0-9a-fA-F]{6}$/.test(inputColor)
              ? inputColor
              : (trelloColors[inputColor] ?? "#64748b");
            await this.insert("labels", {
              id: randomUUID(),
              projectId,
              name,
              color,
              position: await this.nextPosition("labels", projectId),
            });
            return name;
          }),
        ),
      ),
    ];
  }
  private async optionNamed(
    table: "labels" | "priorities" | "task_types" | "impacts",
    projectId: string,
    name: string,
  ) {
    return (await this.find(table, { projectId: projectId }, [], false)).find(
      (row) =>
        String(row.name).normalize("NFC").toLocaleLowerCase("es") ===
        name.normalize("NFC").toLocaleLowerCase("es"),
    );
  }
  private async replaceLabel(
    projectId: string,
    oldName: string,
    newName: string | null,
  ) {
    for (const task of await this.find(
      "tasks",
      { projectId: projectId },
      [],
      false,
    )) {
      const labels = task.labels as string[];
      if (!labels.includes(oldName)) continue;
      await this.update("tasks", String(task.id), {
        labels: [
          ...new Set(
            labels.flatMap((label) =>
              label === oldName ? (newName ? [newName] : []) : [label],
            ),
          ),
        ],
        updatedAt: new Date().toISOString(),
      });
    }
  }
  private async project(
    name: string,
    description: string,
    icon: string,
    color: string,
  ) {
    const id = randomUUID();
    await this.insert("projects", {
      id,
      name,
      description,
      icon,
      color,
      createdAt: new Date().toISOString(),
      leaderId: this.actorContext.getStore()!.id,
    });
    await this.bindContentFiles(
      description,
      this.actorContext.getStore()!,
      id,
      { kind: "project", id, projectId: id },
    );
    await this.defaultPriorities(id);
    for (const [table, options] of [
      ["task_types", DEFAULT_TASK_TYPES],
      ["impacts", DEFAULT_IMPACTS],
    ] as const) {
      await each([...options], async (option, position) =>
        this.insert(table, {
          id: randomUUID(),
          projectId: id,
          ...option,
          position,
        }),
      );
    }
    await each(
      defaults,
      async (s, position) =>
        await this.insert("statuses", {
          id: randomUUID(),
          projectId: id,
          name: s.name,
          color: s.color,
          isDone: s.done,
          position,
        }),
    );
    return id;
  }
  private async feature(
    projectId: string,
    name: string,
    description = "",
    moduleId: string | null = null,
  ) {
    await this.get("projects", projectId);
    await this.validateModule(projectId, moduleId);
    const id = randomUUID();
    await this.insert("features", {
      id,
      leaderId: this.actorContext.getStore()!.id,
      projectId,
      moduleId,
      number: await this.nextFeatureNumber(projectId, moduleId),
      name,
      description,
      position: await this.nextPosition("features", projectId),
    });
    await this.bindContentFiles(
      description,
      this.actorContext.getStore()!,
      projectId,
      { kind: "feature", id, projectId },
    );
    return id;
  }
  private async nextFeatureNumber(projectId: string, moduleId: string | null) {
    const used = new Set(
      (
        await this.find(
          "features",
          { projectId: projectId, moduleId: moduleId },
          [],
          false,
        )
      ).map((feature) => Number(feature.number)),
    );
    let number = 1;
    while (used.has(number)) number++;
    return number;
  }
  private async validateModule(projectId: string, moduleId: string | null) {
    if (
      moduleId !== null &&
      (await this.get("modules", moduleId)).projectId !== projectId
    )
      throw new DomainError(
        "El módulo debe pertenecer al proyecto de la feature.",
      );
  }
  private async recordStatusChange(
    task: Row,
    statusId: string,
    changedAt: string,
  ) {
    if (task.statusId === statusId) return;
    const from = await this.get("statuses", String(task.statusId));
    const to = await this.get("statuses", statusId);
    await this.insert("task_status_history", {
      taskId: task.id,
      fromStatusId: from.id,
      fromStatusName: from.name,
      fromStatusColor: from.color,
      toStatusId: to.id,
      toStatusName: to.name,
      toStatusColor: to.color,
      changedAt,
    });
  }
  async execute(command: Command, actor: Actor): Promise<CommandResult> {
    return this.transaction(async () => {
      const previous = command.type === "task.assignment.update" ? await this.notifications.assignment(command.id) : null;
      const removedRecipients = command.type === "task.delete" || command.type === "project.delete" ? await this.store.db.select({ userId: schema.notifications.recipientId }).from(schema.notifications)
        .innerJoin(schema.tasks, eq(schema.tasks.id, schema.notifications.taskId)).where(command.type === "task.delete" ? eq(schema.tasks.id, command.id) : eq(schema.tasks.projectId, command.id)) : [];
      const result = await this.executeCommand(command, actor);
      if (removedRecipients.length) await this.notifications.accessChanged(removedRecipients.map((r) => r.userId));
      if (command.type === "project.team.remove") await this.notifications.accessChanged([command.userId]);
      if (command.type === "task.assignment.update" || command.type === "task.create") {
        const id = command.type === "task.create" ? result.createdId! : command.id;
        await this.notifications.assigned(id, actor, previous);
      }
      if (command.type === "task.create") await this.notifications.reconcile([result.createdId!]);
      else if (["task.update", "task.assignment.update", "task.archive", "task.move"].includes(command.type) && "id" in command)
        await this.notifications.reconcile([command.id]);
      else if (["status.update", "project.timezone.update", "project.team.remove", "trello.import"].includes(command.type))
        await this.notifications.reconcile();
      return result;
    });
  }
  private async executeCommand(command: Command, actor: Actor): Promise<CommandResult> {
    return this.actorContext.run(actor, async () =>
      this.transaction(async () => {
        await this.authorize(command, actor);
        if (command.type === "project.timezone.update") {
          await this.update("projects", command.id, { timeZone: command.timeZone });
          return {};
        }
        if (
          command.type === "project.assignment.update" ||
          command.type === "module.assignment.update" ||
          command.type === "feature.assignment.update"
        ) {
          await this.setEntityAssignment(
            actor,
            command.type.split(".")[0] as "project" | "module" | "feature",
            command.id,
            command.leaderId,
            command.teamMemberIds,
          );
          return {};
        }
        if (command.type === "settings.update") {
          await this.store.db
            .update(schema.installation)
            .set({ maxAttachmentBytes: command.maxAttachmentBytes })
            .where(eq(schema.installation.id, 1));
          return {};
        }
        if (
          command.type === "module.leader.update" ||
          command.type === "feature.leader.update"
        ) {
          const table = command.type.startsWith("module.")
            ? "modules"
            : "features";
          const row = await this.get(table, command.id);
          await this.requireParticipant(String(row.projectId), command.userId);
          await this.update(table, command.id, { leaderId: command.userId });
          const kind = table === "modules" ? "module" : "feature";
          await this.remove(`${kind}_team_members`, {
            [`${kind}Id`]: command.id,
            userId: command.userId,
          });
          return {};
        }
        if (command.type === "task.assignment.update") {
          const task = await this.get("tasks", command.id);
          await this.setTaskAssignment(
            command.id,
            String(task.projectId),
            command.leaderId,
            command.teamMemberIds,
          );
          return {};
        }
        if (await this.accessCommand(command)) return {};
        const c = command;
        switch (c.type) {
          case "client.create":
          case "client.update": {
            if (c.type === "client.update") await this.get("clients", c.id);
            if (!(await this.find("cities", { id: c.cityId }))[0])
              throw new DomainError("Selecciona una ciudad válida.");
            const normalizedName = normalizeClientText(c.name);
            if (!normalizedName) throw new DomainError("Escribe un nombre.");
            const duplicate = (
              await this.find("clients", { normalizedName, cityId: c.cityId })
            ).some((row) => c.type === "client.create" || row.id !== c.id);
            if (duplicate)
              throw new DomainError(
                "Ya existe un cliente con ese nombre en esta ciudad.",
                409,
              );
            const fields = {
              name: c.name.trim().replace(/\s+/g, " "),
              normalizedName,
              cityId: c.cityId,
              updatedAt: new Date().toISOString(),
            };
            if (c.type === "client.create") {
              const id = randomUUID();
              await this.insert("clients", {
                id,
                ...fields,
                createdAt: fields.updatedAt,
              });
              return { createdId: id };
            }
            await this.update("clients", c.id, fields);
            break;
          }
          case "client.delete":
            await this.get("clients", c.id);
            if ((await this.find("task_clients", { clientId: c.id })).length)
              throw new DomainError(
                "El cliente tiene tareas relacionadas. Desvincúlalo antes de eliminarlo.",
                409,
              );
            await this.remove("clients", { id: c.id });
            break;
          case "project.create": {
            const id = await this.project(
              c.name,
              c.description,
              c.icon,
              c.color,
            );
            await this.feature(id, "General");
            return { createdId: id };
          }
          case "project.update":
            await this.bindContentFiles(c.description, actor, c.id, {
              kind: "project",
              id: c.id,
              projectId: c.id,
            });
            await this.update("projects", c.id, {
              name: c.name,
              description: c.description,
              icon: c.icon,
              color: c.color,
            });
            break;
          case "project.rename":
          case "module.rename":
          case "feature.rename":
            await this.update(
              { project: "projects", module: "modules", feature: "features" }[
                c.type.split(".")[0] as "project" | "module" | "feature"
              ],
              c.id,
              { name: c.name },
            );
            break;
          case "project.delete":
            await this.get("projects", c.id);
            await this.remove("tasks", { projectId: c.id });
            await this.remove("features", { projectId: c.id });
            await this.remove("projects", { id: c.id });
            break;
          case "module.create": {
            await this.get("projects", c.projectId);
            const id = randomUUID();
            await this.insert("modules", {
              id,
              leaderId: actor.id,
              projectId: c.projectId,
              name: c.name,
              description: c.description,
              position: await this.nextPosition("modules", c.projectId),
            });
            await this.bindContentFiles(c.description, actor, c.projectId, {
              kind: "module",
              id,
              projectId: c.projectId,
            });
            return { createdId: id };
          }
          case "module.update": {
            const module = await this.get("modules", c.id);
            const projectId = String(module.projectId);
            await this.bindContentFiles(c.description, actor, projectId, {
              kind: "module",
              id: c.id,
              projectId,
            });
            await this.update("modules", c.id, {
              name: c.name,
              description: c.description,
            });
            break;
          }
          case "module.delete": {
            const module = await this.get("modules", c.id);
            for (const feature of (await this.all("features")).filter(
              (feature) => feature.moduleId === c.id,
            ))
              await this.update("features", String(feature.id), {
                moduleId: null,
                number: await this.nextFeatureNumber(
                  String(module.projectId),
                  null,
                ),
              });
            await this.remove("modules", { id: c.id });
            break;
          }
          case "module.reorder": {
            await this.get("projects", c.projectId);
            const existing = (await this.all("modules"))
              .filter((module) => module.projectId === c.projectId)
              .map((module) => String(module.id));
            if (
              existing.length !== c.ids.length ||
              new Set(c.ids).size !== existing.length ||
              c.ids.some((id) => !existing.includes(id))
            )
              throw new DomainError(
                "La lista de módulos cambió. Actualiza la página y vuelve a intentarlo.",
              );
            await each(
              c.ids,
              async (id, position) =>
                await this.update("modules", id, { position }),
            );
            break;
          }
          case "feature.create":
            return {
              createdId: await this.feature(
                c.projectId,
                c.name,
                c.description,
                c.moduleId ?? null,
              ),
            };
          case "feature.update": {
            const feature = await this.get("features", c.id);
            await this.bindContentFiles(
              c.description,
              actor,
              String(feature.projectId),
              {
                kind: "feature",
                id: c.id,
                projectId: String(feature.projectId),
              },
            );
            const moduleId =
              c.moduleId === undefined
                ? (feature.moduleId as string | null)
                : c.moduleId;
            await this.validateModule(String(feature.projectId), moduleId);
            await this.update("features", c.id, {
              name: c.name,
              description: c.description,
              moduleId,
              number:
                moduleId === feature.moduleId
                  ? feature.number
                  : await this.nextFeatureNumber(
                      String(feature.projectId),
                      moduleId,
                    ),
            });
            break;
          }
          case "feature.delete":
            await this.get("features", c.id);
            await this.remove("features", { id: c.id });
            break;
          case "feature.pin": {
            const feature = await this.get("features", c.id);
            if (
              c.pinned &&
              !feature.pinned &&
              Number(
                (
                  await this.countWhere("features", {
                    projectId: feature.projectId,
                    pinned: true,
                  })
                )?.n,
              ) >= 5
            ) {
              throw new DomainError(
                "Puedes fijar un máximo de 5 features por proyecto. Desfija una antes de añadir otra.",
              );
            }
            await this.update("features", c.id, { pinned: c.pinned });
            break;
          }
          case "feature.reorder": {
            await this.get("projects", c.projectId);
            const existing = (await this.all("features"))
              .filter((f) => f.projectId === c.projectId)
              .map((f) => String(f.id));
            if (
              existing.length !== c.ids.length ||
              new Set(c.ids).size !== existing.length ||
              c.ids.some((id) => !existing.includes(id))
            ) {
              throw new DomainError(
                "La lista de features cambió. Actualiza la página y vuelve a intentarlo.",
              );
            }
            await each(
              c.ids,
              async (id, position) =>
                await this.update("features", id, { position }),
            );
            break;
          }
          case "status.create":
          case "status.update": {
            const p =
              c.type === "status.create"
                ? c.projectId
                : String((await this.get("statuses", c.id)).projectId);
            await this.get("projects", p);
            const duplicate = (
              await this.find(
                "statuses",
                { projectId: p, name: c.name },
                ["name"],
                false,
              )
            )[0];
            if (
              duplicate &&
              (c.type === "status.create" || duplicate.id !== c.id)
            )
              throw new DomainError("Ya existe un estado con ese nombre.");
            if (c.type === "status.create") {
              const id = randomUUID();
              await this.insert("statuses", {
                id,
                projectId: p,
                name: c.name,
                color: c.color,
                isDone: c.isDone,
                position: await this.nextPosition("statuses", p),
              });
              return { createdId: id };
            }
            await this.update("statuses", c.id, {
              name: c.name,
              color: c.color,
              isDone: c.isDone,
            });
            break;
          }
          case "status.delete": {
            const s = await this.get("statuses", c.id);
            if (
              Number(
                (await this.countWhere("statuses", { projectId: s.projectId }))
                  ?.n,
              ) <= 1
            )
              throw new DomainError("El proyecto necesita al menos un estado.");
            if (Number((await this.countWhere("tasks", { statusId: c.id }))?.n))
              throw new DomainError(
                "Mueve las tareas de este estado antes de eliminarlo, incluidas las archivadas.",
              );
            await this.remove("statuses", { id: c.id });
            break;
          }
          case "status.reorder": {
            const existing = (await this.all("statuses"))
              .filter((s) => s.projectId === c.projectId)
              .map((s) => s.id);
            await this.get("projects", c.projectId);
            if (
              existing.length !== c.ids.length ||
              new Set(c.ids).size !== existing.length ||
              c.ids.some((id) => !existing.includes(id))
            )
              throw new DomainError(
                "La lista de estados cambió. Vuelve a intentarlo.",
              );
            await each(
              c.ids,
              async (id, position) =>
                await this.update("statuses", id, { position }),
            );
            break;
          }
          case "task.create":
          case "task.update": {
            const existing =
              c.type === "task.update" ? await this.get("tasks", c.id) : null;
            const clientIds =
              c.clientIds === undefined ? undefined : [...new Set(c.clientIds)];
            if (clientIds) {
              const valid = clientIds.length
                ? await this.store.db
                    .select({ id: schema.clients.id })
                    .from(schema.clients)
                    .where(inArray(schema.clients.id, clientIds))
                : [];
              if (valid.length !== clientIds.length)
                throw new DomainError(
                  "Uno de los clientes seleccionados ya no existe.",
                );
            }
            const p =
              c.type === "task.create"
                ? c.projectId
                : String(existing!.projectId);
            if (
              (await this.get("features", c.featureId)).projectId !== p ||
              (await this.get("statuses", c.statusId)).projectId !== p
            )
              throw new DomainError(
                "La feature y el estado deben pertenecer al proyecto.",
              );
            if (c.dueTime && !c.dueDate)
              throw new DomainError(
                "Selecciona una fecha para asignar una hora.",
              );
            const startDate =
              c.startDate === undefined
                ? (existing?.startDate ?? null)
                : c.startDate;
            const startTime = startDate
              ? c.startTime === undefined
                ? (existing?.startTime ?? null)
                : c.startTime
              : null;
            const dueTime = c.dueDate
              ? c.dueTime === undefined
                ? (existing?.dueTime ?? null)
                : c.dueTime
              : null;
            if (c.startTime && !startDate)
              throw new DomainError(
                "Selecciona una fecha para asignar una hora de inicio.",
              );
            if (startDate && c.dueDate) {
              if (
                String(startDate) > c.dueDate ||
                ((startTime || dueTime) &&
                  `${startDate}T${startTime ?? "00:00"}` >=
                    `${c.dueDate}T${dueTime ?? "24:00"}`)
              )
                throw new DomainError(
                  "La entrega debe ser posterior al inicio de la tarea.",
                );
            }
            if (
              !(
                await this.find(
                  "priorities",
                  { id: c.priority, projectId: p },
                  [],
                  false,
                )
              )[0]
            )
              throw new DomainError(
                "La prioridad debe pertenecer al proyecto.",
              );
            const labels = await this.ensureLabels(p, c.labels);
            const typeId =
              c.typeId === undefined ? (existing?.typeId ?? null) : c.typeId;
            const impactId =
              c.impactId === undefined
                ? (existing?.impactId ?? null)
                : c.impactId;
            for (const [table, id, noun] of [
              ["task_types", typeId, "El tipo"],
              ["impacts", impactId, "El impacto"],
            ] as const) {
              if (
                id !== null &&
                !(await this.find(table, { id, projectId: p }, [], false))[0]
              )
                throw new DomainError(`${noun} debe pertenecer al proyecto.`);
            }
            const fields = {
              featureId: c.featureId,
              statusId: c.statusId,
              title: c.title,
              description: c.description,
              priority: c.priority,
              typeId,
              impactId,
              ticketNumber:
                c.ticketNumber === undefined
                  ? (existing?.ticketNumber ?? null)
                  : c.ticketNumber?.trim() || null,
              dueDate: c.dueDate,
              startDate,
              startTime,
              dueTime: c.dueDate
                ? c.dueTime === undefined
                  ? (existing?.dueTime ?? null)
                  : c.dueTime
                : null,
              labels,
              updatedAt: new Date().toISOString(),
            };
            if (c.type === "task.create") {
              await this.requireParticipant(p, c.leaderId ?? actor.id);
              const id = randomUUID();
              await this.insert("tasks", {
                id,
                createdById: actor.id,
                leaderId: c.leaderId ?? actor.id,
                projectId: p,
                ...fields,
                archived: false,
                position: await this.nextPosition("tasks", p),
                externalId: null,
                createdAt: fields.updatedAt,
              });
              for (const clientId of clientIds ?? [])
                await this.insert("task_clients", { taskId: id, clientId });
              await this.setTaskAssignment(
                id,
                p,
                c.leaderId ?? actor.id,
                c.teamMemberIds ?? [],
              );
              await this.bindContentFiles(c.description, actor, p, id);
              return { createdId: id };
            }
            await this.recordStatusChange(
              existing!,
              c.statusId,
              fields.updatedAt,
            );
            await this.update("tasks", c.id, fields);
            await this.bindContentFiles(c.description, actor, p, c.id);
            if (clientIds !== undefined) {
              await this.remove("task_clients", { taskId: c.id });
              for (const clientId of clientIds)
                await this.insert("task_clients", { taskId: c.id, clientId });
            }
            break;
          }
          case "task.clients.update": {
            await this.get("tasks", c.id);
            const clientIds = [...new Set(c.clientIds)];
            const valid = clientIds.length
              ? await this.store.db
                  .select({ id: schema.clients.id })
                  .from(schema.clients)
                  .where(inArray(schema.clients.id, clientIds))
              : [];
            if (valid.length !== clientIds.length)
              throw new DomainError(
                "Uno de los clientes seleccionados ya no existe.",
              );
            await this.remove("task_clients", { taskId: c.id });
            for (const clientId of clientIds)
              await this.insert("task_clients", { taskId: c.id, clientId });
            await this.update("tasks", c.id, {
              updatedAt: new Date().toISOString(),
            });
            break;
          }
          case "task.move": {
            const t = await this.get("tasks", c.id);
            if (
              (await this.get("statuses", c.statusId)).projectId !== t.projectId
            )
              throw new DomainError("El estado pertenece a otro proyecto.");
            if (t.archived)
              throw new DomainError("Restaura la tarea antes de moverla.");
            const ids = (await this.all("tasks"))
              .filter(
                (x) =>
                  x.projectId === t.projectId &&
                  x.statusId === c.statusId &&
                  !x.archived &&
                  x.id !== c.id,
              )
              .map((x) => String(x.id));
            const index =
              c.beforeId === null ? ids.length : ids.indexOf(c.beforeId);
            if (index < 0)
              throw new DomainError(
                "La tarea de destino cambió. Vuelve a intentarlo.",
              );
            ids.splice(index, 0, c.id);
            const changedAt = new Date().toISOString();
            await this.recordStatusChange(t, c.statusId, changedAt);
            await this.update("tasks", c.id, {
              statusId: c.statusId,
              updatedAt: changedAt,
            });
            await each(
              ids,
              async (id, position) =>
                await this.update("tasks", id, { position }),
            );
            break;
          }
          case "task.archive":
            await this.update("tasks", c.id, {
              archived: c.archived,
              updatedAt: new Date().toISOString(),
            });
            break;
          case "task.rename":
            await this.update("tasks", c.id, {
              title: c.title,
              updatedAt: new Date().toISOString(),
            });
            break;
          case "task.delete":
            await this.get("tasks", c.id);
            await this.remove("tasks", { id: c.id });
            break;
          case "priority.create":
          case "priority.update":
          case "taskType.create":
          case "taskType.update":
          case "impact.create":
          case "impact.update":
          case "label.create":
          case "label.update": {
            const table = c.type.startsWith("priority")
              ? "priorities"
              : c.type.startsWith("taskType")
                ? "task_types"
                : c.type.startsWith("impact")
                  ? "impacts"
                  : "labels";
            const creating = c.type.endsWith("create");
            await this.get("projects", c.projectId);
            const existing = !creating
              ? (
                  await this.find(
                    table,
                    { id: "id" in c ? c.id : "", projectId: c.projectId },
                    [],
                    false,
                  )
                )[0]
              : null;
            if (!creating && !existing)
              throw new DomainError("La opción no pertenece al proyecto.", 404);
            const duplicate = await this.optionNamed(
              table,
              c.projectId,
              c.name,
            );
            if (duplicate && (creating || duplicate.id !== existing?.id))
              throw new DomainError("Ya existe una opción con ese nombre.");
            const id = existing ? String(existing.id) : randomUUID();
            if (creating)
              await this.insert(table, {
                id,
                projectId: c.projectId,
                name: c.name,
                color: c.color,
                position: await this.nextPosition(table, c.projectId),
              });
            else {
              await this.patchWhere(
                table,
                { id: id, projectId: c.projectId },
                { name: c.name, color: c.color },
              );
              if (table === "labels")
                await this.replaceLabel(
                  c.projectId,
                  String(existing!.name),
                  c.name,
                );
            }
            return { createdId: id };
          }
          case "priority.delete":
          case "taskType.delete":
          case "impact.delete":
          case "label.delete": {
            const table =
              c.type === "priority.delete"
                ? "priorities"
                : c.type === "taskType.delete"
                  ? "task_types"
                  : c.type === "impact.delete"
                    ? "impacts"
                    : "labels";
            await this.get("projects", c.projectId);
            const option = (
              await this.find(
                table,
                { id: c.id, projectId: c.projectId },
                [],
                false,
              )
            )[0];
            if (!option)
              throw new DomainError("La opción no pertenece al proyecto.", 404);
            if (table === "task_types" || table === "impacts") {
              const field = table === "task_types" ? "typeId" : "impactId";
              if (
                (
                  await this.countWhere("tasks", {
                    projectId: c.projectId,
                    [field]: c.id,
                  })
                )?.n
              )
                throw new DomainError(
                  `Cambia o quita ${table === "task_types" ? "el tipo" : "el impacto"} de las tareas que lo usan, incluidas las archivadas, antes de eliminarlo.`,
                );
            } else if (table === "priorities") {
              if (
                Number(
                  (
                    await this.countWhere("priorities", {
                      projectId: c.projectId,
                    })
                  )?.n,
                ) <= 1
              )
                throw new DomainError(
                  "El proyecto necesita al menos una prioridad.",
                );
              if (
                (
                  await this.find(
                    "tasks",
                    { projectId: c.projectId, priority: c.id },
                    [],
                    false,
                  )
                )[0]
              )
                throw new DomainError(
                  "Cambia la prioridad de las tareas que la usan, incluidas las archivadas, antes de eliminarla.",
                );
            } else
              await this.replaceLabel(c.projectId, String(option.name), null);
            await this.remove(table, { id: c.id, projectId: c.projectId });
            break;
          }
          case "checklist.create": {
            await this.get("tasks", c.taskId);
            if (
              (
                await this.find("checklists", { taskId: c.taskId }, [], false)
              )[0]
            )
              throw new DomainError("La tarea ya tiene un checklist.");
            const id = randomUUID();
            await this.insert("checklists", {
              id,
              taskId: c.taskId,
              title: c.title,
              position: 0,
            });
            return { createdId: id };
          }
          case "checklist.update":
            await this.update("checklists", c.id, { title: c.title });
            break;
          case "checklist.delete":
            await this.get("checklists", c.id);
            await this.remove("checklists", { id: c.id });
            break;
          case "checklist.item.create": {
            await this.get("checklists", c.checklistId);
            const id = randomUUID();
            await this.insert("checklist_items", {
              id,
              checklistId: c.checklistId,
              title: c.title,
              completed: false,
              position: Number(
                (
                  await this.positionWhere("checklist_items", {
                    checklistId: c.checklistId,
                  })
                )?.n,
              ),
            });
            return { createdId: id };
          }
          case "checklist.item.update":
            await this.update("checklist_items", c.id, {
              title: c.title,
              completed: c.completed,
            });
            break;
          case "checklist.item.delete":
            await this.get("checklist_items", c.id);
            await this.remove("checklist_items", { id: c.id });
            break;
          case "comment.create": {
            const scope = await this.commentScope(c);
            if (c.requestId) {
              const existing = (
                await this.find("comments", { id: c.requestId })
              )[0];
              if (existing) {
                if (
                  !sameEntity(
                    rowScope(existing as Parameters<typeof rowScope>[0]),
                    scope,
                  ) ||
                  existing.authorId !== actor.id
                )
                  throw new DomainError(
                    "El identificador del mensaje ya está en uso.",
                    409,
                  );
                return { createdId: c.requestId };
              }
            }
            const id = c.requestId ?? randomUUID(),
              now = new Date().toISOString();
            await this.insert("comments", {
              id,
              authorId: actor.id,
              ...entityColumns(scope),
              content: c.content,
              createdAt: now,
              updatedAt: now,
            });
            await this.bindContentFiles(
              c.content,
              actor,
              scope.projectId,
              scope,
            );
            return { createdId: id };
          }
          case "comment.update": {
            const comment = await this.get("comments", c.id);
            const scope = rowScope(comment as Parameters<typeof rowScope>[0])!;
            await this.bindContentFiles(
              c.content,
              actor,
              scope.projectId,
              scope,
            );
            await this.update("comments", c.id, {
              content: c.content,
              updatedAt: new Date().toISOString(),
            });
            break;
          }
          case "comment.delete":
            await this.get("comments", c.id);
            await this.remove("comments", { id: c.id });
            break;
          case "trello.import":
            return { report: await this.importTrello(c.board, c.projectId) };
        }
        return {};
      }),
    );
  }
  private async importTrello(board: TrelloBoard, target: string | null) {
    const projectId =
      target ??
      (await this.project(
        board.name,
        "Importado desde Trello.",
        "📋",
        "#059669",
      ));
    await this.get("projects", projectId);
    if (
      new Set(board.lists.map((l) => l.id)).size !== board.lists.length ||
      new Set(board.cards.map((c) => c.id)).size !== board.cards.length
    )
      throw new DomainError("El archivo contiene identificadores duplicados.");
    const statusMap = new Map<string, string>();
    const listMap = new Map(board.lists.map((l) => [l.id, l]));
    let imported = 0,
      skipped = 0,
      featureId: string | null = null;
    const ensureStatus = async (listId: string) => {
      if (statusMap.has(listId)) return statusMap.get(listId)!;
      const name = listMap.get(listId)?.name ?? "Sin lista";
      const existing = (
        await this.find(
          "statuses",
          { projectId: projectId, name: name },
          ["name"],
          false,
        )
      )[0];
      const statusId = existing ? String(existing.id) : randomUUID();
      if (!existing)
        await this.insert("statuses", {
          id: statusId,
          projectId,
          name,
          color: "#64748b",
          position: await this.nextPosition("statuses", projectId),
          isDone: false,
        });
      statusMap.set(listId, statusId);
      return statusId;
    };
    await each(
      [...board.lists].sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0)),
      async (l) => {
        await ensureStatus(l.id);
      },
    );
    for (const card of [...board.cards].sort(
      (a, b) => (a.pos ?? 0) - (b.pos ?? 0),
    )) {
      if (
        (
          await this.find(
            "tasks",
            { projectId: projectId, externalId: `trello:${card.id}` },
            [],
            false,
          )
        )[0]
      ) {
        skipped++;
        continue;
      }
      featureId ??= await this.feature(
        projectId,
        board.name,
        "Tareas importadas desde Trello.",
      );
      await this.insert("tasks", {
        id: randomUUID(),
        createdById: this.actorContext.getStore()!.id,
        leaderId: this.actorContext.getStore()!.id,
        projectId,
        featureId,
        statusId: await ensureStatus(card.idList),
        title: card.name,
        description: card.desc,
        priority: (
          await this.find("priorities", { projectId: projectId }, [], true)
        )[0]!.id as string,
        dueDate: card.due
          ? new Date(card.due).toISOString().slice(0, 10)
          : null,
        archived: Boolean(
          card.closed || listMap.get(card.idList)?.closed || false,
        ),
        position: await this.nextPosition("tasks", projectId),
        labels: await this.ensureLabels(
          projectId,
          card.labels.map((l) => l.name || l.color || "Etiqueta"),
          card.labels.map((l) => l.color ?? ""),
        ),
        externalId: `trello:${card.id}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      imported++;
    }
    return { imported, skipped, projectId };
  }
}
