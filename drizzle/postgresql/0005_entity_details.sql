ALTER TABLE "comments" DROP CONSTRAINT "comments_taskId_tasks_id_fk";
--> statement-breakpoint
DROP TRIGGER taskode_comment_changed ON comments;
--> statement-breakpoint
ALTER TABLE "comment_outbox" DROP CONSTRAINT "comment_outbox_pkey";
--> statement-breakpoint
ALTER TABLE "comment_outbox" ALTER COLUMN "taskId" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "comments" ALTER COLUMN "taskId" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "comment_outbox" ADD COLUMN "scopeType" text DEFAULT 'task' NOT NULL;
--> statement-breakpoint
ALTER TABLE "comment_outbox" ADD COLUMN "scopeId" text;
--> statement-breakpoint
UPDATE comment_outbox SET "scopeId" = "taskId";
--> statement-breakpoint
ALTER TABLE "comment_outbox" ALTER COLUMN "scopeId" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "comment_outbox" ADD CONSTRAINT "comment_outbox_scopeType_scopeId_pk" PRIMARY KEY("scopeType","scopeId");
--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "projectId" text;
--> statement-breakpoint
UPDATE comments c SET "projectId" = t."projectId" FROM tasks t WHERE t.id = c."taskId";
--> statement-breakpoint
ALTER TABLE "comments" ALTER COLUMN "projectId" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "scopeType" text DEFAULT 'task' NOT NULL;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "moduleId" text;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "featureId" text;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "scopeType" text;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "moduleId" text;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "featureId" text;--> statement-breakpoint
UPDATE files SET "scopeType" = 'task' WHERE "taskId" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "module_identity" ON "modules" USING btree ("id","projectId");
--> statement-breakpoint
CREATE UNIQUE INDEX "task_identity" ON "tasks" USING btree ("id","projectId");
--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_taskId_projectId_tasks_id_projectId_fk" FOREIGN KEY ("taskId","projectId") REFERENCES "tasks"("id","projectId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_moduleId_projectId_modules_id_projectId_fk" FOREIGN KEY ("moduleId","projectId") REFERENCES "modules"("id","projectId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_featureId_projectId_features_id_projectId_fk" FOREIGN KEY ("featureId","projectId") REFERENCES "features"("id","projectId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_taskId_projectId_tasks_id_projectId_fk" FOREIGN KEY ("taskId","projectId") REFERENCES "tasks"("id","projectId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_moduleId_projectId_modules_id_projectId_fk" FOREIGN KEY ("moduleId","projectId") REFERENCES "modules"("id","projectId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_featureId_projectId_features_id_projectId_fk" FOREIGN KEY ("featureId","projectId") REFERENCES "features"("id","projectId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comment_scope" ON "comments" USING btree ("projectId","scopeType","moduleId","featureId","createdAt");--> statement-breakpoint
CREATE INDEX "file_scope" ON "files" USING btree ("projectId","scopeType","moduleId","featureId");--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comment_scope_target" CHECK (("comments"."scopeType" = 'project' and num_nonnulls("comments"."taskId", "comments"."moduleId", "comments"."featureId") = 0) or ("comments"."scopeType" = 'task' and "comments"."taskId" is not null and num_nonnulls("comments"."taskId", "comments"."moduleId", "comments"."featureId") = 1) or ("comments"."scopeType" = 'module' and "comments"."moduleId" is not null and num_nonnulls("comments"."taskId", "comments"."moduleId", "comments"."featureId") = 1) or ("comments"."scopeType" = 'feature' and "comments"."featureId" is not null and num_nonnulls("comments"."taskId", "comments"."moduleId", "comments"."featureId") = 1));--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "file_scope_target" CHECK (coalesce((("files"."scopeType" is null and num_nonnulls("files"."taskId", "files"."moduleId", "files"."featureId") = 0) or ("files"."scopeType" = 'project' and num_nonnulls("files"."taskId", "files"."moduleId", "files"."featureId") = 0) or ("files"."scopeType" = 'task' and "files"."taskId" is not null and num_nonnulls("files"."taskId", "files"."moduleId", "files"."featureId") = 1) or ("files"."scopeType" = 'module' and "files"."moduleId" is not null and num_nonnulls("files"."taskId", "files"."moduleId", "files"."featureId") = 1) or ("files"."scopeType" = 'feature' and "files"."featureId" is not null and num_nonnulls("files"."taskId", "files"."moduleId", "files"."featureId") = 1)), false));--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "file_scope_ready" CHECK ("files"."scopeType" is null or "files"."status" = 'ready');
--> statement-breakpoint
CREATE OR REPLACE FUNCTION taskode_queue_comment_change() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE changed comments%ROWTYPE; affected_id text;
BEGIN
  IF TG_OP = 'DELETE' THEN changed := OLD; ELSE changed := NEW; END IF;
  affected_id := CASE changed."scopeType"
    WHEN 'project' THEN changed."projectId" WHEN 'module' THEN changed."moduleId"
    WHEN 'feature' THEN changed."featureId" ELSE changed."taskId" END;
  INSERT INTO comment_outbox ("scopeType", "scopeId", "taskId", "eventId")
  VALUES (changed."scopeType", affected_id, changed."taskId", gen_random_uuid()::text)
  ON CONFLICT ("scopeType", "scopeId") DO UPDATE SET
    "eventId" = excluded."eventId", attempts = 0, "availableAt" = now(), "leaseUntil" = null;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER taskode_comment_changed AFTER INSERT OR UPDATE OR DELETE ON comments
FOR EACH ROW EXECUTE FUNCTION taskode_queue_comment_change();
