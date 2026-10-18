CREATE TABLE "documents" (
	"id" text PRIMARY KEY NOT NULL,
	"projectId" text NOT NULL,
	"scopeType" text NOT NULL,
	"taskId" text,
	"moduleId" text,
	"featureId" text,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"createdAt" text NOT NULL,
	"updatedAt" text NOT NULL,
	CONSTRAINT "document_revision" CHECK ("documents"."revision" > 0),
	CONSTRAINT "document_scope_target" CHECK (("documents"."scopeType" = 'project' and num_nonnulls("documents"."taskId", "documents"."moduleId", "documents"."featureId") = 0) or ("documents"."scopeType" = 'task' and "documents"."taskId" is not null and num_nonnulls("documents"."taskId", "documents"."moduleId", "documents"."featureId") = 1) or ("documents"."scopeType" = 'module' and "documents"."moduleId" is not null and num_nonnulls("documents"."taskId", "documents"."moduleId", "documents"."featureId") = 1) or ("documents"."scopeType" = 'feature' and "documents"."featureId" is not null and num_nonnulls("documents"."taskId", "documents"."moduleId", "documents"."featureId") = 1))
);
--> statement-breakpoint
ALTER TABLE "files" ALTER COLUMN "purpose" SET DEFAULT 'file';--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_taskId_projectId_tasks_id_projectId_fk" FOREIGN KEY ("taskId","projectId") REFERENCES "tasks"("id","projectId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_moduleId_projectId_modules_id_projectId_fk" FOREIGN KEY ("moduleId","projectId") REFERENCES "modules"("id","projectId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_featureId_projectId_features_id_projectId_fk" FOREIGN KEY ("featureId","projectId") REFERENCES "features"("id","projectId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_scope" ON "documents" USING btree ("projectId","scopeType","taskId","moduleId","featureId");
--> statement-breakpoint
UPDATE "files" SET "purpose" = 'file' WHERE "purpose" = 'document';
