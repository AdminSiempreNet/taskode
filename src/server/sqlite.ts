import { DatabaseSync, backup } from "node:sqlite";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  and,
  eq,
  inArray,
  isNull,
  getTableColumns,
  sql,
  type SQL,
} from "drizzle-orm";
import type { AnySQLiteTable } from "drizzle-orm/sqlite-core";
import { DatabaseStore } from "./database";
import * as schema from "./schema";
import type { Command, TrelloBoard } from "../lib/validation";
import type { Actor, CurrentUser, ImportReport, Workspace } from "../lib/types";
import { DomainError, type WorkspaceRepository } from "./repository";

type Row = Record<string, string | number | null>;
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
const restoreTables = [
  "user",
  "account",
  "installation",
  "projects",
  "project_members",
  "modules",
  "features",
  "statuses",
  "priorities",
  "labels",
  "tasks",
  "checklists",
  "checklist_items",
  "comments",
  "task_status_history",
  "invitations",
  "invitation_projects",
  "session",
  "verification",
  "__drizzle_migrations",
];

export class SqliteRepository implements WorkspaceRepository {
  readonly store: DatabaseStore;
  readonly db: DatabaseSync;
  private restoring = false;
  private temporaryDirectory?: string;
  private actorContext = new AsyncLocalStorage<Actor>();
  constructor(path: string, _legacySeed = false) {
    if (path === ":memory:") {
      this.temporaryDirectory = mkdtempSync(join(tmpdir(), "brote-test-"));
      path = join(this.temporaryDirectory, "workspace.sqlite");
    }
    this.store = new DatabaseStore(path);
    this.db = new DatabaseSync(path, { timeout: 5000 });
    this.db.exec("PRAGMA foreign_keys=ON;");
  }
  private table(name: string): AnySQLiteTable {
    const table = schema.domainTables[name as keyof typeof schema.domainTables];
    if (!table) throw new Error("Tabla de dominio desconocida.");
    return table;
  }
  private condition(
    table: AnySQLiteTable,
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
            ? sql`${columns[key]} = ${value} collate nocase`
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
    if (user.role === "admin" || project.ownerId === user.id) return project;
    const member = (
      await this.store.db
        .select()
        .from(schema.projectMembers)
        .where(
          and(
            eq(schema.projectMembers.projectId, projectId),
            eq(schema.projectMembers.userId, user.id),
          ),
        )
    )[0];
    if (!member)
      throw new DomainError("El proyecto no existe o no tienes acceso.", 404);
    if (manage)
      throw new DomainError(
        "Solo el propietario o el administrador puede realizar esta acción.",
        403,
      );
    return project;
  }
  private async authorize(command: Command, actor: Actor) {
    await this.currentUser(actor);
    const c = command;
    if (
      c.type === "project.create" ||
      (c.type === "trello.import" && c.projectId === null)
    )
      return;
    if (c.type === "project.transferOwnership") {
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
      if ("taskId" in c) {
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
    const manage = /^(project\.|status\.|priority\.|label\.|trello\.)/.test(
      c.type,
    );
    await this.requireProject(actor, projectId, manage);
  }
  private async accessCommand(command: Command): Promise<boolean> {
    const c = command;
    if (c.type === "project.transferOwnership") {
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
        .insert(schema.projectMembers)
        .values({ projectId: c.id, userId: String(old.ownerId) })
        .onConflictDoNothing();
      await this.update("projects", c.id, { ownerId: c.userId });
      await this.store.db
        .delete(schema.projectMembers)
        .where(
          and(
            eq(schema.projectMembers.projectId, c.id),
            eq(schema.projectMembers.userId, c.userId),
          ),
        );
      return true;
    }
    if (c.type === "project.member.add" || c.type === "project.member.remove") {
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
      if (project.ownerId === c.userId)
        throw new DomainError("El propietario ya tiene acceso al proyecto.");
      if (c.type === "project.member.add")
        await this.store.db
          .insert(schema.projectMembers)
          .values({ projectId: c.projectId, userId: c.userId })
          .onConflictDoNothing();
      else
        await this.store.db
          .delete(schema.projectMembers)
          .where(
            and(
              eq(schema.projectMembers.projectId, c.projectId),
              eq(schema.projectMembers.userId, c.userId),
            ),
          );
      return true;
    }
    return false;
  }
  async getWorkspace(actor: Actor): Promise<Workspace> {
    const currentUser = await this.currentUser(actor);
    const memberships = await this.store.db
      .select()
      .from(schema.projectMembers)
      .where(eq(schema.projectMembers.userId, actor.id));
    const projects = (await this.all("projects")).filter(
      (p) =>
        currentUser.role === "admin" ||
        p.ownerId === actor.id ||
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
    const [modules, features, statuses, priorities, labels, tasks] =
      await Promise.all([
        rows("modules"),
        rows("features"),
        rows("statuses"),
        rows("priorities"),
        rows("labels"),
        rows("tasks"),
      ]);
    const taskIds = tasks.map((t) => String(t.id));
    const [lists, comments, history] = await Promise.all([
      rows("checklists", "taskId", taskIds),
      rows("comments", "taskId", taskIds),
      rows("task_status_history", "taskId", taskIds),
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
      projects,
      modules: sort(modules),
      features: sort(features).map((f) => ({
        ...f,
        pinned: Boolean(f.pinned),
      })),
      statuses: sort(statuses).map((s) => ({
        ...s,
        isDone: Boolean(s.isDone),
      })),
      priorities: sort(priorities),
      labels: sort(labels),
      tasks: sort(tasks).map((t) => {
        const { externalId: _, ...row } = t;
        return {
          ...row,
          archived: Boolean(t.archived),
          labels: JSON.parse(String(t.labels)),
          checklists: sort(lists.filter((l) => l.taskId === t.id)).map((l) => ({
            ...l,
            items: sort(items.filter((i) => i.checklistId === l.id)).map(
              (i) => ({ ...i, completed: Boolean(i.completed) }),
            ),
          })),
          comments: comments
            .filter((c) => c.taskId === t.id)
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
  async exportBackup(destination: string) {
    await this.store.ready;
    await backup(this.db, destination);
  }
  async restoreBackup(source: string, beforeRestore?: () => Promise<void>) {
    await this.store.ready;
    if (this.restoring)
      throw new DomainError("Ya hay una restauración en curso.", 409);
    this.restoring = true;
    let input: DatabaseSync | undefined,
      attached = false,
      validated = false;
    try {
      input = new DatabaseSync(source, { readOnly: true });
      input.exec("PRAGMA trusted_schema=OFF;");
      if (input.prepare("PRAGMA user_version").get()?.user_version !== 8)
        throw new DomainError(
          "El respaldo no es compatible. Se requiere un respaldo de Brote con autenticación.",
        );
      const objects = input
        .prepare(
          "SELECT name,type,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'",
        )
        .all();
      if (
        objects.some(
          (o) =>
            !["table", "index"].includes(String(o.type)) ||
            (o.type === "table" && !restoreTables.includes(String(o.name))) ||
            /CREATE\s+VIRTUAL\s+TABLE/i.test(String(o.sql)),
        )
      )
        throw new DomainError(
          "El respaldo contiene una estructura no compatible.",
        );
      for (const table of restoreTables) {
        const expected = this.db.prepare(`PRAGMA table_info("${table}")`).all(),
          actual = input.prepare(`PRAGMA table_info("${table}")`).all();
        if (
          !actual.length ||
          JSON.stringify(expected) !== JSON.stringify(actual)
        )
          throw new DomainError(
            "El respaldo está incompleto o tiene una estructura incompatible.",
          );
      }
      if (
        input.prepare("PRAGMA integrity_check").get()?.integrity_check !==
          "ok" ||
        input.prepare("PRAGMA foreign_key_check").all().length
      )
        throw new DomainError(
          "El respaldo está dañado o tiene referencias inválidas.",
        );
      const admin = input
        .prepare(
          "SELECT u.id FROM installation i JOIN user u ON u.id=i.adminId WHERE i.id=1 AND u.role='admin'",
        )
        .get();
      if (!admin)
        throw new DomainError(
          "El respaldo no contiene un administrador válido.",
        );
      for (const task of input.prepare("SELECT labels FROM tasks").all()) {
        const labels = JSON.parse(String(task.labels));
        if (!Array.isArray(labels) || labels.some((l) => typeof l !== "string"))
          throw new DomainError("El respaldo contiene etiquetas inválidas.");
      }
      input.close();
      input = undefined;
      validated = true;
      await beforeRestore?.();
      this.db.prepare("ATTACH DATABASE ? AS restore_source").run(source);
      attached = true;
      this.db.exec("PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;");
      try {
        for (const table of restoreTables) {
          const columns = this.db
            .prepare(`PRAGMA table_info("${table}")`)
            .all()
            .map((c) => `"${String(c.name)}"`)
            .join(",");
          this.db.exec(
            `DELETE FROM main."${table}"; INSERT INTO main."${table}" (${columns}) SELECT ${columns} FROM restore_source."${table}";`,
          );
        }
        this.db.exec(
          "DELETE FROM main.sqlite_sequence; INSERT INTO main.sqlite_sequence SELECT * FROM restore_source.sqlite_sequence; DELETE FROM session; DELETE FROM verification; UPDATE invitations SET revokedAt=COALESCE(revokedAt,unixepoch()*1000) WHERE acceptedAt IS NULL;",
        );
        if (this.db.prepare("PRAGMA main.foreign_key_check").all().length)
          throw new DomainError("El respaldo tiene referencias inválidas.");
        this.db.exec("COMMIT;");
      } catch (error) {
        this.db.exec("ROLLBACK;");
        throw error;
      } finally {
        this.db.exec("PRAGMA foreign_keys=ON;");
      }
    } catch (error) {
      if (error instanceof DomainError || validated) throw error;
      throw new DomainError(
        "No se pudo restaurar un respaldo SQLite válido y compatible.",
      );
    } finally {
      input?.close();
      if (attached) this.db.exec("DETACH DATABASE restore_source;");
      this.restoring = false;
    }
  }
  async close() {
    await this.store.ready.catch(() => {});
    this.store.close();
    this.db.close();
    if (this.temporaryDirectory) {
      const { rm } = await import("node:fs/promises");
      await rm(this.temporaryDirectory, {
        recursive: true,
        force: true,
        maxRetries: 12,
        retryDelay: 50,
      });
    }
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
        await Promise.all(
          names.map(async (name, index) => {
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
    table: "labels" | "priorities",
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
      const labels: string[] = JSON.parse(String(task.labels));
      if (!labels.includes(oldName)) continue;
      await this.update("tasks", String(task.id), {
        labels: JSON.stringify([
          ...new Set(
            labels.flatMap((label) =>
              label === oldName ? (newName ? [newName] : []) : [label],
            ),
          ),
        ]),
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
      ownerId: this.actorContext.getStore()!.id,
    });
    await this.defaultPriorities(id);
    await each(
      defaults,
      async (s, position) =>
        await this.insert("statuses", {
          id: randomUUID(),
          projectId: id,
          name: s.name,
          color: s.color,
          isDone: Number(s.done),
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
      projectId,
      moduleId,
      number: await this.nextFeatureNumber(projectId, moduleId),
      name,
      description,
      position: await this.nextPosition("features", projectId),
    });
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
    if (this.restoring)
      throw new DomainError(
        "Hay una restauración en curso. Espera a que termine.",
        409,
      );
    return this.actorContext.run(actor, async () =>
      this.transaction(async () => {
        await this.authorize(command, actor);
        if (await this.accessCommand(command)) return {};
        const c = command;
        switch (c.type) {
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
            await this.update("projects", c.id, {
              name: c.name,
              description: c.description,
              icon: c.icon,
              color: c.color,
            });
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
              projectId: c.projectId,
              name: c.name,
              description: c.description,
              position: await this.nextPosition("modules", c.projectId),
            });
            return { createdId: id };
          }
          case "module.update":
            await this.update("modules", c.id, {
              name: c.name,
              description: c.description,
            });
            break;
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
                    pinned: 1,
                  })
                )?.n,
              ) >= 5
            ) {
              throw new DomainError(
                "Puedes fijar un máximo de 5 features por proyecto. Desfija una antes de añadir otra.",
              );
            }
            await this.update("features", c.id, { pinned: Number(c.pinned) });
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
                isDone: Number(c.isDone),
                position: await this.nextPosition("statuses", p),
              });
              return { createdId: id };
            }
            await this.update("statuses", c.id, {
              name: c.name,
              color: c.color,
              isDone: Number(c.isDone),
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
            const fields = {
              featureId: c.featureId,
              statusId: c.statusId,
              title: c.title,
              description: c.description,
              priority: c.priority,
              dueDate: c.dueDate,
              startDate,
              startTime,
              dueTime: c.dueDate
                ? c.dueTime === undefined
                  ? (existing?.dueTime ?? null)
                  : c.dueTime
                : null,
              labels: JSON.stringify(labels),
              updatedAt: new Date().toISOString(),
            };
            if (c.type === "task.create") {
              const id = randomUUID();
              await this.insert("tasks", {
                id,
                projectId: p,
                ...fields,
                archived: 0,
                position: await this.nextPosition("tasks", p),
                externalId: null,
                createdAt: fields.updatedAt,
              });
              return { createdId: id };
            }
            await this.recordStatusChange(
              existing!,
              c.statusId,
              fields.updatedAt,
            );
            await this.update("tasks", c.id, fields);
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
              archived: Number(c.archived),
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
          case "label.create":
          case "label.update": {
            const table = c.type.startsWith("priority")
              ? "priorities"
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
          case "label.delete": {
            const table =
              c.type === "priority.delete" ? "priorities" : "labels";
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
            if (table === "priorities") {
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
              completed: 0,
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
              completed: Number(c.completed),
            });
            break;
          case "checklist.item.delete":
            await this.get("checklist_items", c.id);
            await this.remove("checklist_items", { id: c.id });
            break;
          case "comment.create": {
            await this.get("tasks", c.taskId);
            const id = randomUUID(),
              now = new Date().toISOString();
            await this.insert("comments", {
              id,
              taskId: c.taskId,
              content: c.content,
              createdAt: now,
              updatedAt: now,
            });
            return { createdId: id };
          }
          case "comment.update":
            await this.update("comments", c.id, {
              content: c.content,
              updatedAt: new Date().toISOString(),
            });
            break;
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
          isDone: 0,
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
        archived: Number(
          card.closed || listMap.get(card.idList)?.closed || false,
        ),
        position: await this.nextPosition("tasks", projectId),
        labels: JSON.stringify(
          await this.ensureLabels(
            projectId,
            card.labels.map((l) => l.name || l.color || "Etiqueta"),
            card.labels.map((l) => l.color ?? ""),
          ),
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
