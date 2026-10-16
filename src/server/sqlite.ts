import { DatabaseSync, backup, type SQLInputValue } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Command, TrelloBoard } from "../lib/validation";
import type {
  Feature,
  ImportReport,
  Project,
  Status,
  Task,
  Workspace,
} from "../lib/types";
import { DomainError, type WorkspaceRepository } from "./repository";

const defaults = [
  { name: "Pendiente", color: "#64748b", done: false },
  { name: "En proceso", color: "#3b82f6", done: false },
  { name: "En revisión", color: "#f59e0b", done: false },
  { name: "Terminado", color: "#059669", done: true },
];
// Copy data into the existing connection so other open connections and WAL
// readers keep using the same database file. Never replace a live SQLite file.
const restoreTables = [
  "projects",
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
] as const;
type Row = Record<string, SQLInputValue>;

export class SqliteRepository implements WorkspaceRepository {
  readonly db: DatabaseSync;
  private restoring = false;
  constructor(path: string, seed = true) {
    if (path !== ":memory:")
      mkdirSync(dirname(resolve(path)), { recursive: true });
    this.db = new DatabaseSync(path, { timeout: 5000 });
    this.db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;");
    try {
      this.migrate(seed);
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  private migrate(seed: boolean) {
    const version = Number(
      this.db.prepare("PRAGMA user_version").get()?.user_version,
    );
    if (version > 7)
      throw new Error(
        "La base de datos requiere una versión más reciente de Brote.",
      );
    if (version === 7) return;
    this.transaction(() => {
      if (version === 0) {
        this.db.exec(`
        CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, icon TEXT NOT NULL, color TEXT NOT NULL, createdAt TEXT NOT NULL);
        CREATE TABLE features (id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, name TEXT NOT NULL, description TEXT NOT NULL, position REAL NOT NULL, UNIQUE(id, projectId));
        CREATE TABLE statuses (id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, name TEXT NOT NULL, color TEXT NOT NULL, position REAL NOT NULL, isDone INTEGER NOT NULL DEFAULT 0, UNIQUE(id, projectId), UNIQUE(projectId, name COLLATE NOCASE));
        CREATE TABLE tasks (id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, featureId TEXT NOT NULL, statusId TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, priority TEXT NOT NULL CHECK(priority IN ('low','medium','high')), dueDate TEXT, archived INTEGER NOT NULL DEFAULT 0, position REAL NOT NULL, labels TEXT NOT NULL DEFAULT '[]', externalId TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
          FOREIGN KEY(featureId,projectId) REFERENCES features(id,projectId) ON DELETE CASCADE,
          FOREIGN KEY(statusId,projectId) REFERENCES statuses(id,projectId), UNIQUE(projectId,externalId));
        CREATE INDEX task_project ON tasks(projectId,archived);
        CREATE INDEX task_feature ON tasks(featureId);
        CREATE INDEX task_status ON tasks(statusId);
        PRAGMA user_version=1;
      `);
      }
      if (version < 2)
        this.db.exec(
          "ALTER TABLE features ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0,1));",
        );
      if (version < 3)
        this.db.exec(
          "ALTER TABLE tasks ADD COLUMN dueTime TEXT CHECK(dueTime IS NULL OR (dueDate IS NOT NULL AND dueTime GLOB '[0-2][0-9]:[0-5][0-9]' AND dueTime < '24:00')); PRAGMA user_version=3;",
        );
      if (version < 4) {
        this.db.exec(`
        CREATE TABLE priorities (id TEXT NOT NULL, projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, name TEXT NOT NULL, color TEXT NOT NULL, position REAL NOT NULL, PRIMARY KEY(id, projectId), UNIQUE(projectId, name COLLATE NOCASE));
        CREATE TABLE labels (id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, name TEXT NOT NULL, color TEXT NOT NULL, position REAL NOT NULL, UNIQUE(projectId, name COLLATE NOCASE));
      `);
        for (const p of this.all("projects"))
          this.defaultPriorities(String(p.id));
        this.db.exec(`
        CREATE TABLE tasks_new (id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, featureId TEXT NOT NULL, statusId TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, priority TEXT NOT NULL, dueDate TEXT, archived INTEGER NOT NULL DEFAULT 0, position REAL NOT NULL, labels TEXT NOT NULL DEFAULT '[]', externalId TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
          dueTime TEXT CHECK(dueTime IS NULL OR (dueDate IS NOT NULL AND dueTime GLOB '[0-2][0-9]:[0-5][0-9]' AND dueTime < '24:00')),
          startDate TEXT, startTime TEXT CHECK(startTime IS NULL OR (startDate IS NOT NULL AND startTime GLOB '[0-2][0-9]:[0-5][0-9]' AND startTime < '24:00')),
          FOREIGN KEY(featureId,projectId) REFERENCES features(id,projectId) ON DELETE CASCADE,
          FOREIGN KEY(statusId,projectId) REFERENCES statuses(id,projectId),
          FOREIGN KEY(priority,projectId) REFERENCES priorities(id,projectId), UNIQUE(projectId,externalId));
        INSERT INTO tasks_new (id,projectId,featureId,statusId,title,description,priority,dueDate,archived,position,labels,externalId,createdAt,updatedAt,dueTime) SELECT id,projectId,featureId,statusId,title,description,priority,dueDate,archived,position,labels,externalId,createdAt,updatedAt,dueTime FROM tasks;
        DROP TABLE tasks;
        ALTER TABLE tasks_new RENAME TO tasks;
        CREATE INDEX task_project ON tasks(projectId,archived);
        CREATE INDEX task_feature ON tasks(featureId);
        CREATE INDEX task_status ON tasks(statusId);
        CREATE TABLE checklists (id TEXT PRIMARY KEY, taskId TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, title TEXT NOT NULL, position REAL NOT NULL);
        CREATE INDEX checklist_task ON checklists(taskId);
        CREATE TABLE checklist_items (id TEXT PRIMARY KEY, checklistId TEXT NOT NULL REFERENCES checklists(id) ON DELETE CASCADE, title TEXT NOT NULL, completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0,1)), position REAL NOT NULL);
        CREATE INDEX item_checklist ON checklist_items(checklistId);
        CREATE TABLE comments (id TEXT PRIMARY KEY, taskId TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, content TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL);
        CREATE INDEX comment_task ON comments(taskId,createdAt);
        PRAGMA user_version=4;
      `);
      }
      if (version < 5)
        this.db.exec(`
        CREATE TABLE modules (id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, name TEXT NOT NULL, description TEXT NOT NULL, position REAL NOT NULL);
        CREATE INDEX module_project ON modules(projectId,position);
        ALTER TABLE features ADD COLUMN moduleId TEXT REFERENCES modules(id) ON DELETE SET NULL;
        CREATE INDEX feature_module ON features(moduleId);
        PRAGMA user_version=5;
      `);
      if (version < 6) {
        // Merge legacy lists before enforcing one checklist per task. Move items
        // before deleting their old lists so the cascade cannot remove them.
        for (const task of this.all("tasks")) {
          const lists = this.db
            .prepare(
              "SELECT id FROM checklists WHERE taskId=? ORDER BY position,id",
            )
            .all(task.id);
          if (lists.length < 2) continue;
          const items = this.db
            .prepare(
              `SELECT item.id FROM checklist_items item JOIN checklists list ON list.id=item.checklistId WHERE list.taskId=? ORDER BY list.position,list.id,item.position,item.id`,
            )
            .all(task.id);
          items.forEach((item, position) =>
            this.update("checklist_items", String(item.id), {
              checklistId: lists[0].id,
              position,
            }),
          );
          for (const list of lists.slice(1))
            this.db.prepare("DELETE FROM checklists WHERE id=?").run(list.id);
        }
        this.db.exec(`
        DROP INDEX checklist_task;
        CREATE UNIQUE INDEX checklist_task ON checklists(taskId);
        CREATE TABLE task_status_history (id INTEGER PRIMARY KEY AUTOINCREMENT, taskId TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, fromStatusId TEXT NOT NULL, fromStatusName TEXT NOT NULL, fromStatusColor TEXT NOT NULL, toStatusId TEXT NOT NULL, toStatusName TEXT NOT NULL, toStatusColor TEXT NOT NULL, changedAt TEXT NOT NULL);
        CREATE INDEX status_history_task ON task_status_history(taskId,id);
        PRAGMA user_version=6;
      `);
      }
      if (version < 7) {
        this.db.exec(
          "ALTER TABLE features ADD COLUMN number INTEGER NOT NULL DEFAULT 1 CHECK(number >= 1);",
        );
        const counters = new Map<string, number>();
        for (const feature of this.all("features")) {
          const key = JSON.stringify([feature.projectId, feature.moduleId]);
          const number = (counters.get(key) ?? 0) + 1;
          counters.set(key, number);
          this.update("features", String(feature.id), { number });
        }
        this.db.exec(`
          CREATE UNIQUE INDEX feature_number ON features(projectId, COALESCE(moduleId, ''), number);
          PRAGMA user_version=7;
        `);
      }
      if (version === 0 && seed) this.seed();
      if (version < 4) {
        for (const t of this.all("tasks")) {
          const labels = this.ensureLabels(
            String(t.projectId),
            JSON.parse(String(t.labels)),
          );
          this.update("tasks", String(t.id), {
            labels: JSON.stringify(labels),
          });
        }
      }
    });
  }
  private transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  private all(table: string): Row[] {
    return this.db
      .prepare(
        `SELECT * FROM ${table} ORDER BY ${table === "projects" ? "createdAt, id" : "position, id"}`,
      )
      .all()
      .map((row) => ({ ...row })) as Row[];
  }
  private get(table: string, id: string): Row {
    const row = this.db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id) as
      Row | undefined;
    if (!row)
      throw new DomainError(
        "El elemento ya no existe. Actualiza la página.",
        404,
      );
    return row;
  }
  private insert(table: string, row: Row) {
    const keys = Object.keys(row);
    this.db
      .prepare(
        `INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
      )
      .run(...Object.values(row));
  }
  private update(table: string, id: string, row: Row) {
    this.get(table, id);
    this.db
      .prepare(
        `UPDATE ${table} SET ${Object.keys(row)
          .map((k) => `${k}=?`)
          .join(",")} WHERE id=?`,
      )
      .run(...Object.values(row), id);
  }
  private nextPosition(table: string, projectId: string): number {
    return Number(
      this.db
        .prepare(
          `SELECT COALESCE(MAX(position),-1)+1 AS position FROM ${table} WHERE projectId=?`,
        )
        .get(projectId)?.position,
    );
  }
  private defaultPriorities(projectId: string) {
    [
      { id: "low", name: "Baja", color: "#64748b" },
      { id: "medium", name: "Media", color: "#d97706" },
      { id: "high", name: "Alta", color: "#dc2626" },
    ].forEach((priority, position) =>
      this.insert("priorities", { ...priority, projectId, position }),
    );
  }
  private ensureLabels(
    projectId: string,
    names: string[],
    colors: string[] = [],
  ): string[] {
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
        names.map((name, index) => {
          const existing = this.optionNamed("labels", projectId, name);
          if (existing) return String(existing.name);
          const inputColor = colors[index] ?? "";
          const color = /^#[0-9a-fA-F]{6}$/.test(inputColor)
            ? inputColor
            : (trelloColors[inputColor] ?? "#64748b");
          this.insert("labels", {
            id: randomUUID(),
            projectId,
            name,
            color,
            position: this.nextPosition("labels", projectId),
          });
          return name;
        }),
      ),
    ];
  }
  private optionNamed(
    table: "labels" | "priorities",
    projectId: string,
    name: string,
  ) {
    return this.db
      .prepare(`SELECT * FROM ${table} WHERE projectId=?`)
      .all(projectId)
      .find(
        (row) =>
          String(row.name).normalize("NFC").toLocaleLowerCase("es") ===
          name.normalize("NFC").toLocaleLowerCase("es"),
      );
  }
  private replaceLabel(
    projectId: string,
    oldName: string,
    newName: string | null,
  ) {
    for (const task of this.db
      .prepare("SELECT id,labels FROM tasks WHERE projectId=?")
      .all(projectId)) {
      const labels: string[] = JSON.parse(String(task.labels));
      if (!labels.includes(oldName)) continue;
      this.update("tasks", String(task.id), {
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
  private project(
    name: string,
    description: string,
    icon: string,
    color: string,
  ) {
    const id = randomUUID();
    this.insert("projects", {
      id,
      name,
      description,
      icon,
      color,
      createdAt: new Date().toISOString(),
    });
    this.defaultPriorities(id);
    defaults.forEach((s, position) =>
      this.insert("statuses", {
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
  private feature(
    projectId: string,
    name: string,
    description = "",
    moduleId: string | null = null,
  ) {
    this.get("projects", projectId);
    this.validateModule(projectId, moduleId);
    const id = randomUUID();
    this.insert("features", {
      id,
      projectId,
      moduleId,
      number: this.nextFeatureNumber(projectId, moduleId),
      name,
      description,
      position: this.nextPosition("features", projectId),
    });
    return id;
  }
  private nextFeatureNumber(projectId: string, moduleId: string | null): number {
    const used = new Set(
      this.db
        .prepare("SELECT number FROM features WHERE projectId=? AND moduleId IS ?")
        .all(projectId, moduleId)
        .map((feature) => Number(feature.number)),
    );
    let number = 1;
    while (used.has(number)) number++;
    return number;
  }
  private validateModule(projectId: string, moduleId: string | null) {
    if (
      moduleId !== null &&
      this.get("modules", moduleId).projectId !== projectId
    )
      throw new DomainError(
        "El módulo debe pertenecer al proyecto de la feature.",
      );
  }
  private recordStatusChange(task: Row, statusId: string, changedAt: string) {
    if (task.statusId === statusId) return;
    const from = this.get("statuses", String(task.statusId));
    const to = this.get("statuses", statusId);
    this.insert("task_status_history", {
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
  private seed() {
    const p = this.project(
      "Mi primer proyecto",
      "Un espacio de ejemplo para conocer Brote. Organiza tus ideas y conviértelas en avances.",
      "🌱",
      "#059669",
    );
    const f = this.feature(
      p,
      "Primeros pasos",
      "Todo lo que necesitas para empezar a organizarte.",
    );
    this.feature(
      p,
      "Ideas por explorar",
      "Dale un lugar a tus próximas ideas.",
    );
    const statuses = this.all("statuses").filter((s) => s.projectId === p);
    const samples = [
      [
        "Crea tu primera feature",
        "Agrupa un objetivo o una parte del proyecto en una feature. Puedes crearla desde la barra lateral.",
        0,
        "medium",
        1,
      ],
      [
        "Trae tus tareas de Trello",
        "Abre Importar Trello y selecciona el archivo JSON exportado de tu tablero. Sus listas se convertirán en estados.",
        0,
        "low",
        3,
      ],
      [
        "Organiza tu flujo de trabajo",
        "Arrastra esta tarjeta a otra columna o cambia su estado desde este detalle. En Configurar estados puedes personalizar el flujo.",
        1,
        "high",
        0,
      ],
      [
        "Explora las tres vistas",
        "Prueba el tablero, la lista y el calendario. Las tareas con fecha aparecen en el calendario.",
        2,
        "medium",
        2,
      ],
      [
        "Tu espacio ya está listo",
        "Estas tareas son ejemplos: edítalas, archívalas o elimínalas cuando quieras.",
        3,
        "low",
        -1,
      ],
    ] as const;
    const today = new Date().toLocaleDateString("en-CA", {
      timeZone: "America/Bogota",
    });
    samples.forEach(([title, description, s, priority, offset], position) => {
      const d = new Date(today + "T12:00:00Z");
      d.setUTCDate(d.getUTCDate() + offset);
      const dueDate = d.toISOString().slice(0, 10);
      this.insert("tasks", {
        id: randomUUID(),
        projectId: p,
        featureId: f,
        statusId: statuses[s].id,
        title,
        description,
        priority,
        dueDate,
        archived: 0,
        position,
        labels: JSON.stringify(["Ejemplo"]),
        externalId: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    });
  }
  getWorkspace(): Workspace {
    const items = this.all("checklist_items");
    const checklists = this.all("checklists").map((list) => ({
      ...list,
      taskId: list.taskId,
      items: items
        .filter((item) => item.checklistId === list.id)
        .map((item) => ({ ...item, completed: Boolean(item.completed) })),
    }));
    const comments = this.db
      .prepare("SELECT * FROM comments ORDER BY createdAt, id")
      .all()
      .map((row) => ({ ...row }));
    const statusHistory = this.db
      .prepare("SELECT * FROM task_status_history ORDER BY id DESC")
      .all()
      .map((row) => ({ ...row }));
    return {
      priorities: this.all("priorities") as unknown as Workspace["priorities"],
      labels: this.all("labels") as unknown as Workspace["labels"],
      projects: this.all("projects") as unknown as Project[],
      modules: this.all("modules") as unknown as Workspace["modules"],
      features: this.all("features").map((f) => ({
        ...f,
        pinned: Boolean(f.pinned),
      })) as unknown as Feature[],
      statuses: this.all("statuses").map((s) => ({
        ...s,
        isDone: Boolean(s.isDone),
      })) as unknown as Status[],
      tasks: this.all("tasks").map((t) => {
        const { externalId: _, ...row } = t;
        return {
          ...row,
          archived: Boolean(t.archived),
          labels: JSON.parse(String(t.labels)),
          checklists: checklists.filter((list) => list.taskId === t.id),
          comments: comments.filter((comment) => comment.taskId === t.id),
          statusHistory: statusHistory.filter(
            (change) => change.taskId === t.id,
          ),
        };
      }) as unknown as Task[],
    };
  }
  execute(command: Command): { report?: ImportReport; createdId?: string } {
    if (this.restoring)
      throw new DomainError(
        "Hay una restauración en curso. Espera a que termine.",
        409,
      );
    return this.transaction(() => {
      const c = command;
      switch (c.type) {
        case "project.create": {
          const id = this.project(c.name, c.description, c.icon, c.color);
          this.feature(id, "General");
          return { createdId: id };
        }
        case "project.update":
          this.update("projects", c.id, {
            name: c.name,
            description: c.description,
            icon: c.icon,
            color: c.color,
          });
          break;
        case "project.delete":
          this.get("projects", c.id);
          this.db.prepare("DELETE FROM tasks WHERE projectId=?").run(c.id);
          this.db.prepare("DELETE FROM features WHERE projectId=?").run(c.id);
          this.db.prepare("DELETE FROM projects WHERE id=?").run(c.id);
          break;
        case "module.create": {
          this.get("projects", c.projectId);
          const id = randomUUID();
          this.insert("modules", {
            id,
            projectId: c.projectId,
            name: c.name,
            description: c.description,
            position: this.nextPosition("modules", c.projectId),
          });
          return { createdId: id };
        }
        case "module.update":
          this.update("modules", c.id, {
            name: c.name,
            description: c.description,
          });
          break;
        case "module.delete": {
          const module = this.get("modules", c.id);
          for (const feature of this.all("features").filter(
            (feature) => feature.moduleId === c.id,
          ))
            this.update("features", String(feature.id), {
              moduleId: null,
              number: this.nextFeatureNumber(String(module.projectId), null),
            });
          this.db.prepare("DELETE FROM modules WHERE id=?").run(c.id);
          break;
        }
        case "module.reorder": {
          this.get("projects", c.projectId);
          const existing = this.all("modules")
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
          c.ids.forEach((id, position) =>
            this.update("modules", id, { position }),
          );
          break;
        }
        case "feature.create":
          return {
            createdId: this.feature(
              c.projectId,
              c.name,
              c.description,
              c.moduleId ?? null,
            ),
          };
        case "feature.update": {
          const feature = this.get("features", c.id);
          const moduleId =
            c.moduleId === undefined
              ? (feature.moduleId as string | null)
              : c.moduleId;
          this.validateModule(String(feature.projectId), moduleId);
          this.update("features", c.id, {
            name: c.name,
            description: c.description,
            moduleId,
            number:
              moduleId === feature.moduleId
                ? feature.number
                : this.nextFeatureNumber(String(feature.projectId), moduleId),
          });
          break;
        }
        case "feature.delete":
          this.get("features", c.id);
          this.db.prepare("DELETE FROM features WHERE id=?").run(c.id);
          break;
        case "feature.pin": {
          const feature = this.get("features", c.id);
          if (
            c.pinned &&
            !feature.pinned &&
            Number(
              this.db
                .prepare(
                  "SELECT COUNT(*) AS n FROM features WHERE projectId=? AND pinned=1",
                )
                .get(feature.projectId)?.n,
            ) >= 5
          ) {
            throw new DomainError(
              "Puedes fijar un máximo de 5 features por proyecto. Desfija una antes de añadir otra.",
            );
          }
          this.update("features", c.id, { pinned: Number(c.pinned) });
          break;
        }
        case "feature.reorder": {
          this.get("projects", c.projectId);
          const existing = this.all("features")
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
          c.ids.forEach((id, position) =>
            this.update("features", id, { position }),
          );
          break;
        }
        case "status.create":
        case "status.update": {
          const p =
            c.type === "status.create"
              ? c.projectId
              : String(this.get("statuses", c.id).projectId);
          this.get("projects", p);
          const duplicate = this.db
            .prepare(
              "SELECT id FROM statuses WHERE projectId=? AND name=? COLLATE NOCASE",
            )
            .get(p, c.name);
          if (
            duplicate &&
            (c.type === "status.create" || duplicate.id !== c.id)
          )
            throw new DomainError("Ya existe un estado con ese nombre.");
          if (c.type === "status.create") {
            const id = randomUUID();
            this.insert("statuses", {
              id,
              projectId: p,
              name: c.name,
              color: c.color,
              isDone: Number(c.isDone),
              position: this.nextPosition("statuses", p),
            });
            return { createdId: id };
          }
          this.update("statuses", c.id, {
            name: c.name,
            color: c.color,
            isDone: Number(c.isDone),
          });
          break;
        }
        case "status.delete": {
          const s = this.get("statuses", c.id);
          if (
            Number(
              this.db
                .prepare("SELECT COUNT(*) AS n FROM statuses WHERE projectId=?")
                .get(s.projectId)?.n,
            ) <= 1
          )
            throw new DomainError("El proyecto necesita al menos un estado.");
          if (
            Number(
              this.db
                .prepare("SELECT COUNT(*) AS n FROM tasks WHERE statusId=?")
                .get(c.id)?.n,
            )
          )
            throw new DomainError(
              "Mueve las tareas de este estado antes de eliminarlo, incluidas las archivadas.",
            );
          this.db.prepare("DELETE FROM statuses WHERE id=?").run(c.id);
          break;
        }
        case "status.reorder": {
          const existing = this.all("statuses")
            .filter((s) => s.projectId === c.projectId)
            .map((s) => s.id);
          this.get("projects", c.projectId);
          if (
            existing.length !== c.ids.length ||
            new Set(c.ids).size !== existing.length ||
            c.ids.some((id) => !existing.includes(id))
          )
            throw new DomainError(
              "La lista de estados cambió. Vuelve a intentarlo.",
            );
          c.ids.forEach((id, position) =>
            this.update("statuses", id, { position }),
          );
          break;
        }
        case "task.create":
        case "task.update": {
          const existing =
            c.type === "task.update" ? this.get("tasks", c.id) : null;
          const p =
            c.type === "task.create"
              ? c.projectId
              : String(existing!.projectId);
          if (
            this.get("features", c.featureId).projectId !== p ||
            this.get("statuses", c.statusId).projectId !== p
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
            !this.db
              .prepare("SELECT id FROM priorities WHERE id=? AND projectId=?")
              .get(c.priority, p)
          )
            throw new DomainError("La prioridad debe pertenecer al proyecto.");
          const labels = this.ensureLabels(p, c.labels);
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
            this.insert("tasks", {
              id,
              projectId: p,
              ...fields,
              archived: 0,
              position: this.nextPosition("tasks", p),
              externalId: null,
              createdAt: fields.updatedAt,
            });
            return { createdId: id };
          }
          this.recordStatusChange(existing!, c.statusId, fields.updatedAt);
          this.update("tasks", c.id, fields);
          break;
        }
        case "task.move": {
          const t = this.get("tasks", c.id);
          if (this.get("statuses", c.statusId).projectId !== t.projectId)
            throw new DomainError("El estado pertenece a otro proyecto.");
          if (t.archived)
            throw new DomainError("Restaura la tarea antes de moverla.");
          const ids = this.all("tasks")
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
          this.recordStatusChange(t, c.statusId, changedAt);
          this.update("tasks", c.id, {
            statusId: c.statusId,
            updatedAt: changedAt,
          });
          ids.forEach((id, position) => this.update("tasks", id, { position }));
          break;
        }
        case "task.archive":
          this.update("tasks", c.id, {
            archived: Number(c.archived),
            updatedAt: new Date().toISOString(),
          });
          break;
        case "task.rename":
          this.update("tasks", c.id, {
            title: c.title,
            updatedAt: new Date().toISOString(),
          });
          break;
        case "task.delete":
          this.get("tasks", c.id);
          this.db.prepare("DELETE FROM tasks WHERE id=?").run(c.id);
          break;
        case "priority.create":
        case "priority.update":
        case "label.create":
        case "label.update": {
          const table = c.type.startsWith("priority") ? "priorities" : "labels";
          const creating = c.type.endsWith("create");
          this.get("projects", c.projectId);
          const existing = !creating
            ? this.db
                .prepare(`SELECT * FROM ${table} WHERE id=? AND projectId=?`)
                .get("id" in c ? c.id : "", c.projectId)
            : null;
          if (!creating && !existing)
            throw new DomainError("La opción no pertenece al proyecto.", 404);
          const duplicate = this.optionNamed(table, c.projectId, c.name);
          if (duplicate && (creating || duplicate.id !== existing?.id))
            throw new DomainError("Ya existe una opción con ese nombre.");
          const id = existing ? String(existing.id) : randomUUID();
          if (creating)
            this.insert(table, {
              id,
              projectId: c.projectId,
              name: c.name,
              color: c.color,
              position: this.nextPosition(table, c.projectId),
            });
          else {
            this.db
              .prepare(
                `UPDATE ${table} SET name=?,color=? WHERE id=? AND projectId=?`,
              )
              .run(c.name, c.color, id, c.projectId);
            if (table === "labels")
              this.replaceLabel(c.projectId, String(existing!.name), c.name);
          }
          return { createdId: id };
        }
        case "priority.delete":
        case "label.delete": {
          const table = c.type === "priority.delete" ? "priorities" : "labels";
          this.get("projects", c.projectId);
          const option = this.db
            .prepare(`SELECT * FROM ${table} WHERE id=? AND projectId=?`)
            .get(c.id, c.projectId);
          if (!option)
            throw new DomainError("La opción no pertenece al proyecto.", 404);
          if (table === "priorities") {
            if (
              Number(
                this.db
                  .prepare(
                    "SELECT COUNT(*) AS n FROM priorities WHERE projectId=?",
                  )
                  .get(c.projectId)?.n,
              ) <= 1
            )
              throw new DomainError(
                "El proyecto necesita al menos una prioridad.",
              );
            if (
              this.db
                .prepare(
                  "SELECT id FROM tasks WHERE projectId=? AND priority=? LIMIT 1",
                )
                .get(c.projectId, c.id)
            )
              throw new DomainError(
                "Cambia la prioridad de las tareas que la usan, incluidas las archivadas, antes de eliminarla.",
              );
          } else this.replaceLabel(c.projectId, String(option.name), null);
          this.db
            .prepare(`DELETE FROM ${table} WHERE id=? AND projectId=?`)
            .run(c.id, c.projectId);
          break;
        }
        case "checklist.create": {
          this.get("tasks", c.taskId);
          if (
            this.db
              .prepare("SELECT id FROM checklists WHERE taskId=?")
              .get(c.taskId)
          )
            throw new DomainError("La tarea ya tiene un checklist.");
          const id = randomUUID();
          this.insert("checklists", {
            id,
            taskId: c.taskId,
            title: c.title,
            position: 0,
          });
          return { createdId: id };
        }
        case "checklist.update":
          this.update("checklists", c.id, { title: c.title });
          break;
        case "checklist.delete":
          this.get("checklists", c.id);
          this.db.prepare("DELETE FROM checklists WHERE id=?").run(c.id);
          break;
        case "checklist.item.create": {
          this.get("checklists", c.checklistId);
          const id = randomUUID();
          this.insert("checklist_items", {
            id,
            checklistId: c.checklistId,
            title: c.title,
            completed: 0,
            position: Number(
              this.db
                .prepare(
                  "SELECT COALESCE(MAX(position),-1)+1 AS n FROM checklist_items WHERE checklistId=?",
                )
                .get(c.checklistId)?.n,
            ),
          });
          return { createdId: id };
        }
        case "checklist.item.update":
          this.update("checklist_items", c.id, {
            title: c.title,
            completed: Number(c.completed),
          });
          break;
        case "checklist.item.delete":
          this.get("checklist_items", c.id);
          this.db.prepare("DELETE FROM checklist_items WHERE id=?").run(c.id);
          break;
        case "comment.create": {
          this.get("tasks", c.taskId);
          const id = randomUUID(),
            now = new Date().toISOString();
          this.insert("comments", {
            id,
            taskId: c.taskId,
            content: c.content,
            createdAt: now,
            updatedAt: now,
          });
          return { createdId: id };
        }
        case "comment.update":
          this.update("comments", c.id, {
            content: c.content,
            updatedAt: new Date().toISOString(),
          });
          break;
        case "comment.delete":
          this.get("comments", c.id);
          this.db.prepare("DELETE FROM comments WHERE id=?").run(c.id);
          break;
        case "trello.import":
          return { report: this.importTrello(c.board, c.projectId) };
      }
      return {};
    });
  }
  private importTrello(
    board: TrelloBoard,
    target: string | null,
  ): ImportReport {
    const projectId =
      target ??
      this.project(board.name, "Importado desde Trello.", "📋", "#059669");
    this.get("projects", projectId);
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
    const ensureStatus = (listId: string) => {
      if (statusMap.has(listId)) return statusMap.get(listId)!;
      const name = listMap.get(listId)?.name ?? "Sin lista";
      const existing = this.db
        .prepare(
          "SELECT id FROM statuses WHERE projectId=? AND name=? COLLATE NOCASE",
        )
        .get(projectId, name);
      const statusId = existing ? String(existing.id) : randomUUID();
      if (!existing)
        this.insert("statuses", {
          id: statusId,
          projectId,
          name,
          color: "#64748b",
          position: this.nextPosition("statuses", projectId),
          isDone: 0,
        });
      statusMap.set(listId, statusId);
      return statusId;
    };
    [...board.lists]
      .sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0))
      .forEach((l) => ensureStatus(l.id));
    for (const card of [...board.cards].sort(
      (a, b) => (a.pos ?? 0) - (b.pos ?? 0),
    )) {
      if (
        this.db
          .prepare("SELECT id FROM tasks WHERE projectId=? AND externalId=?")
          .get(projectId, `trello:${card.id}`)
      ) {
        skipped++;
        continue;
      }
      featureId ??= this.feature(
        projectId,
        board.name,
        "Tareas importadas desde Trello.",
      );
      this.insert("tasks", {
        id: randomUUID(),
        projectId,
        featureId,
        statusId: ensureStatus(card.idList),
        title: card.name,
        description: card.desc,
        priority: this.db
          .prepare(
            "SELECT id FROM priorities WHERE projectId=? ORDER BY CASE WHEN id='medium' THEN 0 ELSE 1 END, position LIMIT 1",
          )
          .get(projectId)!.id as string,
        dueDate: card.due
          ? new Date(card.due).toISOString().slice(0, 10)
          : null,
        archived: Number(
          card.closed || listMap.get(card.idList)?.closed || false,
        ),
        position: this.nextPosition("tasks", projectId),
        labels: JSON.stringify(
          this.ensureLabels(
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
  async exportBackup(destination: string) {
    await backup(this.db, destination);
  }
  async restoreBackup(source: string, beforeRestore?: () => Promise<void>) {
    if (this.restoring)
      throw new DomainError("Ya hay una restauración en curso.", 409);
    this.restoring = true;
    let attached = false;
    try {
      // Validate the isolated copy before migration or touching live data.
      let input: DatabaseSync | undefined;
      let prepared: SqliteRepository | undefined;
      try {
        input = new DatabaseSync(source, { readOnly: true });
        input.exec("PRAGMA trusted_schema=OFF;");
        const version = Number(
          input.prepare("PRAGMA user_version").get()?.user_version,
        );
        if (version > 7)
          throw new DomainError(
            "El respaldo requiere una versión más reciente de Brote.",
          );
        if (version < 1)
          throw new DomainError(
            "El archivo no es un respaldo compatible de Brote.",
          );
        const objects = input
          .prepare(
            "SELECT name,type,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'",
          )
          .all();
        if (
          objects.some(
            (object) =>
              !["table", "index"].includes(String(object.type)) ||
              (object.type === "table" &&
                !restoreTables.includes(
                  object.name as (typeof restoreTables)[number],
                )) ||
              /CREATE\s+VIRTUAL\s+TABLE/i.test(String(object.sql)),
          )
        )
          throw new DomainError(
            "El respaldo contiene una estructura no compatible con Brote.",
          );
        for (const table of ["projects", "features", "statuses", "tasks"])
          if (
            !objects.some(
              (object) => object.type === "table" && object.name === table,
            )
          )
            throw new DomainError(
              "El archivo no es un respaldo completo de Brote.",
            );
        if (
          input.prepare("PRAGMA integrity_check").get()?.integrity_check !==
            "ok" ||
          input.prepare("PRAGMA foreign_key_check").all().length
        )
          throw new DomainError(
            "El respaldo está dañado o contiene referencias inválidas.",
          );
        input.close();
        input = undefined;
        // Older Brote backups migrate only in this private working copy.
        prepared = new SqliteRepository(source, false);
        for (const table of restoreTables) {
          const expected = this.db
            .prepare(`PRAGMA table_info("${table}")`)
            .all();
          const actual = prepared.db
            .prepare(`PRAGMA table_info("${table}")`)
            .all();
          if (JSON.stringify(actual) !== JSON.stringify(expected))
            throw new DomainError(
              "La estructura del respaldo no es compatible con esta versión de Brote.",
            );
        }
        const workspace = prepared.getWorkspace();
        if (
          workspace.tasks.some(
            (task) =>
              !Array.isArray(task.labels) ||
              task.labels.some((label) => typeof label !== "string"),
          )
        )
          throw new DomainError("El respaldo contiene etiquetas inválidas.");
        if (prepared.db.prepare("PRAGMA foreign_key_check").all().length)
          throw new DomainError("El respaldo contiene referencias inválidas.");
      } catch (error) {
        if (error instanceof DomainError) throw error;
        throw new DomainError(
          "El archivo no es un respaldo SQLite válido y compatible de Brote.",
        );
      } finally {
        input?.close();
        prepared?.close();
      }
      // Any failure creating the optional safety copy aborts the restore.
      await beforeRestore?.();
      this.db.prepare("ATTACH DATABASE ? AS restore_source").run(source);
      attached = true;
      this.db.exec("PRAGMA foreign_keys=OFF;");
      try {
        this.transaction(() => {
          for (const table of restoreTables) {
            const columns = this.db
              .prepare(`PRAGMA table_info("${table}")`)
              .all()
              .map((column) => `"${String(column.name)}"`)
              .join(",");
            this.db.exec(
              `DELETE FROM main."${table}"; INSERT INTO main."${table}" (${columns}) SELECT ${columns} FROM restore_source."${table}";`,
            );
          }
          this.db.exec(
            "DELETE FROM main.sqlite_sequence; INSERT INTO main.sqlite_sequence SELECT * FROM restore_source.sqlite_sequence;",
          );
          if (this.db.prepare("PRAGMA main.foreign_key_check").all().length)
            throw new DomainError(
              "No se pudo restaurar: hay referencias inválidas.",
            );
        });
      } finally {
        this.db.exec("PRAGMA foreign_keys=ON;");
      }
    } finally {
      try {
        if (attached) this.db.exec("DETACH DATABASE restore_source;");
      } finally {
        this.restoring = false;
      }
    }
  }
  close() {
    this.db.close();
  }
}
