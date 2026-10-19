CREATE TABLE "applications" (
	"id" text PRIMARY KEY NOT NULL,
	"projectId" text NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"position" double precision NOT NULL,
	"isDefault" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feature_applications" (
	"featureId" text NOT NULL,
	"applicationId" text NOT NULL,
	CONSTRAINT "feature_applications_featureId_applicationId_pk" PRIMARY KEY("featureId","applicationId")
);
--> statement-breakpoint
CREATE TABLE "module_applications" (
	"moduleId" text NOT NULL,
	"applicationId" text NOT NULL,
	CONSTRAINT "module_applications_moduleId_applicationId_pk" PRIMARY KEY("moduleId","applicationId")
);
--> statement-breakpoint
CREATE TABLE "task_applications" (
	"taskId" text NOT NULL,
	"applicationId" text NOT NULL,
	CONSTRAINT "task_applications_taskId_applicationId_pk" PRIMARY KEY("taskId","applicationId")
);
--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_applications" ADD CONSTRAINT "feature_applications_featureId_features_id_fk" FOREIGN KEY ("featureId") REFERENCES "features"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_applications" ADD CONSTRAINT "feature_applications_applicationId_applications_id_fk" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "module_applications" ADD CONSTRAINT "module_applications_moduleId_modules_id_fk" FOREIGN KEY ("moduleId") REFERENCES "modules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "module_applications" ADD CONSTRAINT "module_applications_applicationId_applications_id_fk" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_applications" ADD CONSTRAINT "task_applications_taskId_tasks_id_fk" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_applications" ADD CONSTRAINT "task_applications_applicationId_applications_id_fk" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "application_name" ON "applications" USING btree ("projectId",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "application_default" ON "applications" USING btree ("projectId") WHERE "applications"."isDefault";--> statement-breakpoint
CREATE INDEX "feature_applications_application" ON "feature_applications" USING btree ("applicationId");--> statement-breakpoint
CREATE INDEX "module_applications_application" ON "module_applications" USING btree ("applicationId");--> statement-breakpoint
CREATE INDEX "task_applications_application" ON "task_applications" USING btree ("applicationId");
--> statement-breakpoint
INSERT INTO "applications" ("id", "projectId", "name", "color", "position", "isDefault")
SELECT 'application:' || md5(p.id || ':' || v.name), p.id, v.name, v.color, v.position, v."isDefault"
FROM "projects" p CROSS JOIN (VALUES
  ('Web', '#3b82f6', 0, true),
  ('Android', '#16a34a', 1, false),
  ('iOS', '#64748b', 2, false),
  ('Windows', '#0284c7', 3, false),
  ('macOS', '#8b5cf6', 4, false)
) AS v(name, color, position, "isDefault");
--> statement-breakpoint
INSERT INTO "task_applications" ("taskId", "applicationId")
SELECT t.id, a.id FROM "tasks" t JOIN "applications" a ON a."projectId" = t."projectId" AND a."isDefault";
