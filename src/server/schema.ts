import { relations, sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  real,
  primaryKey,
  uniqueIndex,
  index,
  foreignKey,
  check,
} from "drizzle-orm/sqlite-core";

export const user = sqliteTable("user", {
  id: text().primaryKey(),
  name: text().notNull(),
  email: text().notNull().unique(),
  emailVerified: integer({ mode: "boolean" }).notNull().default(false),
  image: text(),
  createdAt: integer({ mode: "timestamp_ms" }).notNull(),
  updatedAt: integer({ mode: "timestamp_ms" }).notNull(),
  role: text({ enum: ["admin", "member"] })
    .notNull()
    .default("member"),
});
export const session = sqliteTable(
  "session",
  {
    id: text().primaryKey(),
    token: text().notNull().unique(),
    expiresAt: integer({ mode: "timestamp_ms" }).notNull(),
    createdAt: integer({ mode: "timestamp_ms" }).notNull(),
    updatedAt: integer({ mode: "timestamp_ms" }).notNull(),
    ipAddress: text(),
    userAgent: text(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user").on(t.userId)],
);
export const account = sqliteTable(
  "account",
  {
    id: text().primaryKey(),
    accountId: text().notNull(),
    providerId: text().notNull(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text(),
    refreshToken: text(),
    idToken: text(),
    scope: text(),
    password: text(),
    accessTokenExpiresAt: integer({ mode: "timestamp_ms" }),
    refreshTokenExpiresAt: integer({ mode: "timestamp_ms" }),
    createdAt: integer({ mode: "timestamp_ms" }).notNull(),
    updatedAt: integer({ mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    uniqueIndex("account_provider_identity").on(t.providerId, t.accountId),
    index("account_user").on(t.userId),
  ],
);
export const verification = sqliteTable(
  "verification",
  {
    id: text().primaryKey(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: integer({ mode: "timestamp_ms" }).notNull(),
    createdAt: integer({ mode: "timestamp_ms" }).notNull(),
    updatedAt: integer({ mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("verification_identifier").on(t.identifier)],
);
export const installation = sqliteTable(
  "installation",
  {
    id: integer().primaryKey(),
    adminId: text().references(() => user.id),
    onboardingStep: integer().notNull().default(0),
    firstProjectId: text(),
  },
  (t) => [check("single_installation", sql`${t.id} = 1`)],
);
export const projects = sqliteTable(
  "projects",
  {
    id: text().primaryKey(),
    ownerId: text()
      .notNull()
      .references(() => user.id),
    name: text().notNull(),
    description: text().notNull(),
    icon: text().notNull(),
    color: text().notNull(),
    createdAt: text().notNull(),
  },
  (t) => [index("project_owner").on(t.ownerId)],
);
export const projectMembers = sqliteTable(
  "project_members",
  {
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.userId] }),
    index("membership_user").on(t.userId),
  ],
);
export const invitations = sqliteTable(
  "invitations",
  {
    id: text().primaryKey(),
    email: text().notNull(),
    createdBy: text()
      .notNull()
      .references(() => user.id),
    createdAt: integer().notNull(),
    expiresAt: integer().notNull(),
    revokedAt: integer(),
    acceptedAt: integer(),
    acceptedBy: text().references(() => user.id),
    deliveryStatus: text().notNull().default("pending"),
  },
  (t) => [index("invitation_email").on(t.email)],
);
export const invitationProjects = sqliteTable(
  "invitation_projects",
  {
    invitationId: text()
      .notNull()
      .references(() => invitations.id, { onDelete: "cascade" }),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.invitationId, t.projectId] })],
);
export const modules = sqliteTable(
  "modules",
  {
    id: text().primaryKey(),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text().notNull(),
    description: text().notNull(),
    position: real().notNull(),
  },
  (t) => [index("module_project").on(t.projectId, t.position)],
);
export const features = sqliteTable(
  "features",
  {
    id: text().primaryKey(),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    moduleId: text().references(() => modules.id, { onDelete: "set null" }),
    number: integer().notNull().default(1),
    name: text().notNull(),
    description: text().notNull(),
    position: real().notNull(),
    pinned: integer().notNull().default(0),
  },
  (t) => [
    uniqueIndex("feature_identity").on(t.id, t.projectId),
    uniqueIndex("feature_number").on(t.projectId, t.moduleId, t.number),
    uniqueIndex("feature_general_number")
      .on(t.projectId, t.number)
      .where(sql`${t.moduleId} is null`),
    index("feature_module").on(t.moduleId),
    check("positive_feature_number", sql`${t.number} >= 1`),
  ],
);
export const statuses = sqliteTable(
  "statuses",
  {
    id: text().primaryKey(),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text().notNull(),
    color: text().notNull(),
    position: real().notNull(),
    isDone: integer().notNull().default(0),
  },
  (t) => [
    uniqueIndex("status_identity").on(t.id, t.projectId),
    uniqueIndex("status_name").on(t.projectId, sql`${t.name} collate nocase`),
  ],
);
export const priorities = sqliteTable(
  "priorities",
  {
    id: text().notNull(),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text().notNull(),
    color: text().notNull(),
    position: real().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.projectId] }),
    uniqueIndex("priority_name").on(t.projectId, sql`${t.name} collate nocase`),
  ],
);
export const labels = sqliteTable(
  "labels",
  {
    id: text().primaryKey(),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text().notNull(),
    color: text().notNull(),
    position: real().notNull(),
  },
  (t) => [
    uniqueIndex("label_name").on(t.projectId, sql`${t.name} collate nocase`),
  ],
);
export const tasks = sqliteTable(
  "tasks",
  {
    id: text().primaryKey(),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    featureId: text().notNull(),
    statusId: text().notNull(),
    title: text().notNull(),
    description: text().notNull(),
    priority: text().notNull(),
    dueDate: text(),
    dueTime: text(),
    startDate: text(),
    startTime: text(),
    archived: integer().notNull().default(0),
    position: real().notNull(),
    labels: text().notNull().default("[]"),
    externalId: text(),
    createdAt: text().notNull(),
    updatedAt: text().notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.featureId, t.projectId],
      foreignColumns: [features.id, features.projectId],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.statusId, t.projectId],
      foreignColumns: [statuses.id, statuses.projectId],
    }),
    foreignKey({
      columns: [t.priority, t.projectId],
      foreignColumns: [priorities.id, priorities.projectId],
    }),
    uniqueIndex("task_external").on(t.projectId, t.externalId),
    index("task_project").on(t.projectId, t.archived),
    index("task_feature").on(t.featureId),
    index("task_status").on(t.statusId),
    check(
      "due_time",
      sql`${t.dueTime} is null or (${t.dueDate} is not null and ${t.dueTime} glob '[0-2][0-9]:[0-5][0-9]' and ${t.dueTime} < '24:00')`,
    ),
    check(
      "start_time",
      sql`${t.startTime} is null or (${t.startDate} is not null and ${t.startTime} glob '[0-2][0-9]:[0-5][0-9]' and ${t.startTime} < '24:00')`,
    ),
  ],
);
export const checklists = sqliteTable(
  "checklists",
  {
    id: text().primaryKey(),
    taskId: text()
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    title: text().notNull(),
    position: real().notNull(),
  },
  (t) => [uniqueIndex("checklist_task").on(t.taskId)],
);
export const checklistItems = sqliteTable(
  "checklist_items",
  {
    id: text().primaryKey(),
    checklistId: text()
      .notNull()
      .references(() => checklists.id, { onDelete: "cascade" }),
    title: text().notNull(),
    completed: integer().notNull().default(0),
    position: real().notNull(),
  },
  (t) => [
    index("item_checklist").on(t.checklistId),
    check("item_completed", sql`${t.completed} in (0,1)`),
  ],
);
export const comments = sqliteTable(
  "comments",
  {
    id: text().primaryKey(),
    taskId: text()
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    content: text().notNull(),
    createdAt: text().notNull(),
    updatedAt: text().notNull(),
  },
  (t) => [index("comment_task").on(t.taskId, t.createdAt)],
);
export const taskStatusHistory = sqliteTable(
  "task_status_history",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    taskId: text()
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    fromStatusId: text().notNull(),
    fromStatusName: text().notNull(),
    fromStatusColor: text().notNull(),
    toStatusId: text().notNull(),
    toStatusName: text().notNull(),
    toStatusColor: text().notNull(),
    changedAt: text().notNull(),
  },
  (t) => [index("status_history_task").on(t.taskId, t.id)],
);
export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
}));
export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, { fields: [session.userId], references: [user.id] }),
}));
export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, { fields: [account.userId], references: [user.id] }),
}));

export const domainTables = {
  projects,
  modules,
  features,
  statuses,
  priorities,
  labels,
  tasks,
  checklists,
  checklist_items: checklistItems,
  comments,
  task_status_history: taskStatusHistory,
};
