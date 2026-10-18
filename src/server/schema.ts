import { relations, sql } from "drizzle-orm";
import {
  pgTable,
  text,
  integer,
  doublePrecision,
  boolean,
  timestamp,
  bigint,
  jsonb,
  primaryKey,
  uniqueIndex,
  index,
  foreignKey,
  check,
} from "drizzle-orm/pg-core";

export const user = pgTable("user", {
  id: text().primaryKey(),
  name: text().notNull(),
  email: text().notNull().unique(),
  emailVerified: boolean().notNull().default(false),
  image: text(),
  createdAt: timestamp({
    withTimezone: true,
    precision: 3,
    mode: "date",
  }).notNull(),
  updatedAt: timestamp({
    withTimezone: true,
    precision: 3,
    mode: "date",
  }).notNull(),
  role: text({ enum: ["admin", "member"] })
    .notNull()
    .default("member"),
});
export const session = pgTable(
  "session",
  {
    id: text().primaryKey(),
    token: text().notNull().unique(),
    expiresAt: timestamp({
      withTimezone: true,
      precision: 3,
      mode: "date",
    }).notNull(),
    createdAt: timestamp({
      withTimezone: true,
      precision: 3,
      mode: "date",
    }).notNull(),
    updatedAt: timestamp({
      withTimezone: true,
      precision: 3,
      mode: "date",
    }).notNull(),
    ipAddress: text(),
    userAgent: text(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user").on(t.userId)],
);
export const account = pgTable(
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
    accessTokenExpiresAt: timestamp({
      withTimezone: true,
      precision: 3,
      mode: "date",
    }),
    refreshTokenExpiresAt: timestamp({
      withTimezone: true,
      precision: 3,
      mode: "date",
    }),
    createdAt: timestamp({
      withTimezone: true,
      precision: 3,
      mode: "date",
    }).notNull(),
    updatedAt: timestamp({
      withTimezone: true,
      precision: 3,
      mode: "date",
    }).notNull(),
  },
  (t) => [
    uniqueIndex("account_provider_identity").on(t.providerId, t.accountId),
    index("account_user").on(t.userId),
  ],
);
export const verification = pgTable(
  "verification",
  {
    id: text().primaryKey(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: timestamp({
      withTimezone: true,
      precision: 3,
      mode: "date",
    }).notNull(),
    createdAt: timestamp({
      withTimezone: true,
      precision: 3,
      mode: "date",
    }).notNull(),
    updatedAt: timestamp({
      withTimezone: true,
      precision: 3,
      mode: "date",
    }).notNull(),
  },
  (t) => [index("verification_identifier").on(t.identifier)],
);
export const installation = pgTable(
  "installation",
  {
    id: integer().primaryKey(),
    adminId: text().references(() => user.id),
    onboardingStep: integer().notNull().default(0),
    firstProjectId: text(),
    maxAttachmentBytes: integer().notNull().default(10485760),
  },
  (t) => [check("single_installation", sql`${t.id} = 1`)],
);
export const projects = pgTable(
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
export const projectMembers = pgTable(
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
export const invitations = pgTable(
  "invitations",
  {
    id: text().primaryKey(),
    email: text().notNull(),
    createdBy: text()
      .notNull()
      .references(() => user.id),
    createdAt: bigint({ mode: "number" }).notNull(),
    expiresAt: bigint({ mode: "number" }).notNull(),
    revokedAt: bigint({ mode: "number" }),
    acceptedAt: bigint({ mode: "number" }),
    acceptedBy: text().references(() => user.id),
    deliveryStatus: text().notNull().default("pending"),
  },
  (t) => [index("invitation_email").on(t.email)],
);
export const invitationProjects = pgTable(
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
export const modules = pgTable(
  "modules",
  {
    id: text().primaryKey(),
    ownerId: text()
      .notNull()
      .references(() => user.id),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text().notNull(),
    description: text().notNull(),
    position: doublePrecision().notNull(),
  },
  (t) => [index("module_project").on(t.projectId, t.position)],
);
export const features = pgTable(
  "features",
  {
    id: text().primaryKey(),
    ownerId: text()
      .notNull()
      .references(() => user.id),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    moduleId: text().references(() => modules.id, { onDelete: "set null" }),
    number: integer().notNull().default(1),
    name: text().notNull(),
    description: text().notNull(),
    position: doublePrecision().notNull(),
    pinned: boolean().notNull().default(false),
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
export const statuses = pgTable(
  "statuses",
  {
    id: text().primaryKey(),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text().notNull(),
    color: text().notNull(),
    position: doublePrecision().notNull(),
    isDone: boolean().notNull().default(false),
  },
  (t) => [
    uniqueIndex("status_identity").on(t.id, t.projectId),
    uniqueIndex("status_name").on(t.projectId, sql`lower(${t.name})`),
  ],
);
export const priorities = pgTable(
  "priorities",
  {
    id: text().notNull(),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text().notNull(),
    color: text().notNull(),
    position: doublePrecision().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.projectId] }),
    uniqueIndex("priority_name").on(t.projectId, sql`lower(${t.name})`),
  ],
);
export const taskTypes = pgTable(
  "task_types",
  {
    id: text().primaryKey(),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text().notNull(),
    color: text().notNull(),
    position: doublePrecision().notNull(),
  },
  (t) => [uniqueIndex("task_type_name").on(t.projectId, sql`lower(${t.name})`)],
);
export const impacts = pgTable(
  "impacts",
  {
    id: text().primaryKey(),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text().notNull(),
    color: text().notNull(),
    position: doublePrecision().notNull(),
  },
  (t) => [uniqueIndex("impact_name").on(t.projectId, sql`lower(${t.name})`)],
);
export const labels = pgTable(
  "labels",
  {
    id: text().primaryKey(),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text().notNull(),
    color: text().notNull(),
    position: doublePrecision().notNull(),
  },
  (t) => [uniqueIndex("label_name").on(t.projectId, sql`lower(${t.name})`)],
);
export const tasks = pgTable(
  "tasks",
  {
    id: text().primaryKey(),
    createdById: text().references(() => user.id),
    leaderId: text()
      .notNull()
      .references(() => user.id),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    featureId: text().notNull(),
    statusId: text().notNull(),
    title: text().notNull(),
    description: text().notNull(),
    priority: text().notNull(),
    typeId: text().references(() => taskTypes.id),
    impactId: text().references(() => impacts.id),
    ticketNumber: text(),
    dueDate: text(),
    dueTime: text(),
    startDate: text(),
    startTime: text(),
    archived: boolean().notNull().default(false),
    position: doublePrecision().notNull(),
    labels: jsonb().$type<string[]>().notNull().default([]),
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
      sql`${t.dueTime} is null or (${t.dueDate} is not null and ${t.dueTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')`,
    ),
    check(
      "start_time",
      sql`${t.startTime} is null or (${t.startDate} is not null and ${t.startTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')`,
    ),
  ],
);
export const checklists = pgTable(
  "checklists",
  {
    id: text().primaryKey(),
    taskId: text()
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    title: text().notNull(),
    position: doublePrecision().notNull(),
  },
  (t) => [uniqueIndex("checklist_task").on(t.taskId)],
);
export const checklistItems = pgTable(
  "checklist_items",
  {
    id: text().primaryKey(),
    checklistId: text()
      .notNull()
      .references(() => checklists.id, { onDelete: "cascade" }),
    title: text().notNull(),
    completed: boolean().notNull().default(false),
    position: doublePrecision().notNull(),
  },
  (t) => [index("item_checklist").on(t.checklistId)],
);
export const comments = pgTable(
  "comments",
  {
    id: text().primaryKey(),
    authorId: text().references(() => user.id),
    taskId: text()
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    content: text().notNull(),
    createdAt: text().notNull(),
    updatedAt: text().notNull(),
  },
  (t) => [index("comment_task").on(t.taskId, t.createdAt)],
);
export const taskStatusHistory = pgTable(
  "task_status_history",
  {
    id: integer().generatedByDefaultAsIdentity().primaryKey(),
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

export const departments = pgTable("departments", {
  id: text().primaryKey(),
  name: text().notNull(),
});
export const cities = pgTable(
  "cities",
  {
    id: text().primaryKey(),
    departmentId: text()
      .notNull()
      .references(() => departments.id),
    name: text().notNull(),
    kind: text().notNull(),
  },
  (t) => [index("city_department").on(t.departmentId)],
);
export const clients = pgTable(
  "clients",
  {
    id: text().primaryKey(),
    name: text().notNull(),
    normalizedName: text().notNull(),
    cityId: text()
      .notNull()
      .references(() => cities.id),
    createdAt: text().notNull(),
    updatedAt: text().notNull(),
  },
  (t) => [uniqueIndex("client_name_city").on(t.normalizedName, t.cityId)],
);
export const taskClients = pgTable(
  "task_clients",
  {
    taskId: text()
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    clientId: text()
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.clientId] }),
    index("task_client_client").on(t.clientId),
  ],
);

export const taskTeamMembers = pgTable(
  "task_team_members",
  {
    taskId: text()
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.userId] }),
    index("team_member_user").on(t.userId),
  ],
);

export const files = pgTable(
  "files",
  {
    id: text().primaryKey(),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    taskId: text().references(() => tasks.id, { onDelete: "cascade" }),
    uploadedBy: text()
      .notNull()
      .references(() => user.id),
    name: text().notNull(),
    mimeType: text().notNull(),
    size: integer().notNull(),
    storageKey: text().notNull(),
    status: text().notNull().default("pending"),
    purpose: text().notNull().default("document"),
    createdAt: text().notNull(),
  },
  (t) => [
    index("file_task").on(t.taskId),
    index("file_pending").on(t.status, t.createdAt),
  ],
);

// Delivery state is operational data, deliberately excluded from JSON backups.
export const commentOutbox = pgTable(
  "comment_outbox",
  {
    taskId: text().primaryKey(),
    eventId: text().notNull().default(sql`gen_random_uuid()::text`),
    attempts: integer().notNull().default(0),
    availableAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    leaseUntil: timestamp({ withTimezone: true }),
  },
  (t) => [index("comment_outbox_available").on(t.availableAt)],
);

export const domainTables = {
  task_team_members: taskTeamMembers,
  files,
  departments,
  cities,
  clients,
  task_clients: taskClients,
  projects,
  modules,
  features,
  statuses,
  priorities,
  task_types: taskTypes,
  impacts,
  labels,
  tasks,
  checklists,
  checklist_items: checklistItems,
  comments,
  task_status_history: taskStatusHistory,
};
