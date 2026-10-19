-- Existing task notifications retain their source and delivery history.
ALTER TABLE "notifications" ALTER COLUMN "taskId" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "projectId" text;--> statement-breakpoint
UPDATE "notifications" n SET "projectId" = t."projectId" FROM "tasks" t WHERE t.id = n."taskId";--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "projectId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "scopeType" text DEFAULT 'task' NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "moduleId" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "featureId" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "commentId" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "documentId" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_moduleId_modules_id_fk" FOREIGN KEY ("moduleId") REFERENCES "modules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_featureId_features_id_fk" FOREIGN KEY ("featureId") REFERENCES "features"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_commentId_comments_id_fk" FOREIGN KEY ("commentId") REFERENCES "comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_documentId_documents_id_fk" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_project" ON "notifications" USING btree ("projectId");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notification_scope_target" CHECK (("notifications"."scopeType" = 'project' and num_nonnulls("notifications"."taskId", "notifications"."moduleId", "notifications"."featureId") = 0) or ("notifications"."scopeType" = 'task' and "notifications"."taskId" is not null and num_nonnulls("notifications"."taskId", "notifications"."moduleId", "notifications"."featureId") = 1) or ("notifications"."scopeType" = 'module' and "notifications"."moduleId" is not null and num_nonnulls("notifications"."taskId", "notifications"."moduleId", "notifications"."featureId") = 1) or ("notifications"."scopeType" = 'feature' and "notifications"."featureId" is not null and num_nonnulls("notifications"."taskId", "notifications"."moduleId", "notifications"."featureId") = 1));--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notification_source" CHECK (num_nonnulls("notifications"."commentId", "notifications"."documentId") <= 1 and ("notifications"."type" = 'mention' or ("notifications"."scopeType" = 'task' and num_nonnulls("notifications"."commentId", "notifications"."documentId") = 0)));
