CREATE TABLE "files" (
	"id" text PRIMARY KEY NOT NULL,
	"projectId" text NOT NULL,
	"taskId" text,
	"uploadedBy" text NOT NULL,
	"name" text NOT NULL,
	"mimeType" text NOT NULL,
	"size" integer NOT NULL,
	"storageKey" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"purpose" text DEFAULT 'document' NOT NULL,
	"createdAt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_collaborators" (
	"taskId" text NOT NULL,
	"userId" text NOT NULL,
	CONSTRAINT "task_collaborators_taskId_userId_pk" PRIMARY KEY("taskId","userId")
);
--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "authorId" text;--> statement-breakpoint
ALTER TABLE "features" ADD COLUMN "ownerId" text;--> statement-breakpoint
UPDATE "features" t SET "ownerId" = p."ownerId" FROM "projects" p WHERE p.id = t."projectId";--> statement-breakpoint
ALTER TABLE "features" ALTER COLUMN "ownerId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "installation" ADD COLUMN "maxAttachmentBytes" integer DEFAULT 10485760 NOT NULL;--> statement-breakpoint
ALTER TABLE "modules" ADD COLUMN "ownerId" text;--> statement-breakpoint
UPDATE "modules" t SET "ownerId" = p."ownerId" FROM "projects" p WHERE p.id = t."projectId";--> statement-breakpoint
ALTER TABLE "modules" ALTER COLUMN "ownerId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "createdById" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "assigneeId" text;--> statement-breakpoint
UPDATE "tasks" t SET "assigneeId" = p."ownerId" FROM "projects" p WHERE p.id = t."projectId";--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "assigneeId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_taskId_tasks_id_fk" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_uploadedBy_user_id_fk" FOREIGN KEY ("uploadedBy") REFERENCES "user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_collaborators" ADD CONSTRAINT "task_collaborators_taskId_tasks_id_fk" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_collaborators" ADD CONSTRAINT "task_collaborators_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "file_task" ON "files" USING btree ("taskId");--> statement-breakpoint
CREATE INDEX "file_pending" ON "files" USING btree ("status","createdAt");--> statement-breakpoint
CREATE INDEX "collaborator_user" ON "task_collaborators" USING btree ("userId");--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_authorId_user_id_fk" FOREIGN KEY ("authorId") REFERENCES "user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "features" ADD CONSTRAINT "features_ownerId_user_id_fk" FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modules" ADD CONSTRAINT "modules_ownerId_user_id_fk" FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_createdById_user_id_fk" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigneeId_user_id_fk" FOREIGN KEY ("assigneeId") REFERENCES "user"("id") ON DELETE no action ON UPDATE no action;