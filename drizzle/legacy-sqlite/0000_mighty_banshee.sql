CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`accountId` text NOT NULL,
	`providerId` text NOT NULL,
	`userId` text NOT NULL,
	`accessToken` text,
	`refreshToken` text,
	`idToken` text,
	`scope` text,
	`password` text,
	`accessTokenExpiresAt` integer,
	`refreshTokenExpiresAt` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_provider_identity` ON `account` (`providerId`,`accountId`);--> statement-breakpoint
CREATE INDEX `account_user` ON `account` (`userId`);--> statement-breakpoint
CREATE TABLE `checklist_items` (
	`id` text PRIMARY KEY NOT NULL,
	`checklistId` text NOT NULL,
	`title` text NOT NULL,
	`completed` integer DEFAULT 0 NOT NULL,
	`position` real NOT NULL,
	FOREIGN KEY (`checklistId`) REFERENCES `checklists`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "item_completed" CHECK("checklist_items"."completed" in (0,1))
);
--> statement-breakpoint
CREATE INDEX `item_checklist` ON `checklist_items` (`checklistId`);--> statement-breakpoint
CREATE TABLE `checklists` (
	`id` text PRIMARY KEY NOT NULL,
	`taskId` text NOT NULL,
	`title` text NOT NULL,
	`position` real NOT NULL,
	FOREIGN KEY (`taskId`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `checklist_task` ON `checklists` (`taskId`);--> statement-breakpoint
CREATE TABLE `comments` (
	`id` text PRIMARY KEY NOT NULL,
	`taskId` text NOT NULL,
	`content` text NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	FOREIGN KEY (`taskId`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `comment_task` ON `comments` (`taskId`,`createdAt`);--> statement-breakpoint
CREATE TABLE `features` (
	`id` text PRIMARY KEY NOT NULL,
	`projectId` text NOT NULL,
	`moduleId` text,
	`number` integer DEFAULT 1 NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`position` real NOT NULL,
	`pinned` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`moduleId`) REFERENCES `modules`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "positive_feature_number" CHECK("features"."number" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `feature_identity` ON `features` (`id`,`projectId`);--> statement-breakpoint
CREATE UNIQUE INDEX `feature_number` ON `features` (`projectId`,`moduleId`,`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `feature_general_number` ON `features` (`projectId`,`number`) WHERE "features"."moduleId" is null;--> statement-breakpoint
CREATE INDEX `feature_module` ON `features` (`moduleId`);--> statement-breakpoint
CREATE TABLE `installation` (
	`id` integer PRIMARY KEY NOT NULL,
	`adminId` text,
	`onboardingStep` integer DEFAULT 0 NOT NULL,
	`firstProjectId` text,
	FOREIGN KEY (`adminId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "single_installation" CHECK("installation"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE `invitation_projects` (
	`invitationId` text NOT NULL,
	`projectId` text NOT NULL,
	PRIMARY KEY(`invitationId`, `projectId`),
	FOREIGN KEY (`invitationId`) REFERENCES `invitations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`createdBy` text NOT NULL,
	`createdAt` integer NOT NULL,
	`expiresAt` integer NOT NULL,
	`revokedAt` integer,
	`acceptedAt` integer,
	`acceptedBy` text,
	`deliveryStatus` text DEFAULT 'pending' NOT NULL,
	FOREIGN KEY (`createdBy`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`acceptedBy`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `invitation_email` ON `invitations` (`email`);--> statement-breakpoint
CREATE TABLE `labels` (
	`id` text PRIMARY KEY NOT NULL,
	`projectId` text NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`position` real NOT NULL,
	FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `label_name` ON `labels` (`projectId`,"name" collate nocase);--> statement-breakpoint
CREATE TABLE `modules` (
	`id` text PRIMARY KEY NOT NULL,
	`projectId` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`position` real NOT NULL,
	FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `module_project` ON `modules` (`projectId`,`position`);--> statement-breakpoint
CREATE TABLE `priorities` (
	`id` text NOT NULL,
	`projectId` text NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`position` real NOT NULL,
	PRIMARY KEY(`id`, `projectId`),
	FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `priority_name` ON `priorities` (`projectId`,"name" collate nocase);--> statement-breakpoint
CREATE TABLE `project_members` (
	`projectId` text NOT NULL,
	`userId` text NOT NULL,
	PRIMARY KEY(`projectId`, `userId`),
	FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `membership_user` ON `project_members` (`userId`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`ownerId` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`icon` text NOT NULL,
	`color` text NOT NULL,
	`createdAt` text NOT NULL,
	FOREIGN KEY (`ownerId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `project_owner` ON `projects` (`ownerId`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`expiresAt` integer NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`ipAddress` text,
	`userAgent` text,
	`userId` text NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_user` ON `session` (`userId`);--> statement-breakpoint
CREATE TABLE `statuses` (
	`id` text PRIMARY KEY NOT NULL,
	`projectId` text NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`position` real NOT NULL,
	`isDone` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `status_identity` ON `statuses` (`id`,`projectId`);--> statement-breakpoint
CREATE UNIQUE INDEX `status_name` ON `statuses` (`projectId`,"name" collate nocase);--> statement-breakpoint
CREATE TABLE `task_status_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`taskId` text NOT NULL,
	`fromStatusId` text NOT NULL,
	`fromStatusName` text NOT NULL,
	`fromStatusColor` text NOT NULL,
	`toStatusId` text NOT NULL,
	`toStatusName` text NOT NULL,
	`toStatusColor` text NOT NULL,
	`changedAt` text NOT NULL,
	FOREIGN KEY (`taskId`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `status_history_task` ON `task_status_history` (`taskId`,`id`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`projectId` text NOT NULL,
	`featureId` text NOT NULL,
	`statusId` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`priority` text NOT NULL,
	`dueDate` text,
	`dueTime` text,
	`startDate` text,
	`startTime` text,
	`archived` integer DEFAULT 0 NOT NULL,
	`position` real NOT NULL,
	`labels` text DEFAULT '[]' NOT NULL,
	`externalId` text,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`featureId`,`projectId`) REFERENCES `features`(`id`,`projectId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`statusId`,`projectId`) REFERENCES `statuses`(`id`,`projectId`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`priority`,`projectId`) REFERENCES `priorities`(`id`,`projectId`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "due_time" CHECK("tasks"."dueTime" is null or ("tasks"."dueDate" is not null and "tasks"."dueTime" glob '[0-2][0-9]:[0-5][0-9]' and "tasks"."dueTime" < '24:00')),
	CONSTRAINT "start_time" CHECK("tasks"."startTime" is null or ("tasks"."startDate" is not null and "tasks"."startTime" glob '[0-2][0-9]:[0-5][0-9]' and "tasks"."startTime" < '24:00'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `task_external` ON `tasks` (`projectId`,`externalId`);--> statement-breakpoint
CREATE INDEX `task_project` ON `tasks` (`projectId`,`archived`);--> statement-breakpoint
CREATE INDEX `task_feature` ON `tasks` (`featureId`);--> statement-breakpoint
CREATE INDEX `task_status` ON `tasks` (`statusId`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`emailVerified` integer DEFAULT false NOT NULL,
	`image` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`role` text DEFAULT 'member' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expiresAt` integer NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier` ON `verification` (`identifier`);