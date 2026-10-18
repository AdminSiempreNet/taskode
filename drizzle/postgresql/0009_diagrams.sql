CREATE TABLE "diagrams" (
	"id" text PRIMARY KEY NOT NULL,
	"projectId" text NOT NULL,
	"scopeType" text NOT NULL,
	"taskId" text,
	"moduleId" text,
	"featureId" text,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"scene" jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"publicToken" text,
	"createdAt" text NOT NULL,
	"updatedAt" text NOT NULL,
	CONSTRAINT "diagram_revision" CHECK ("diagrams"."revision" > 0),
	CONSTRAINT "diagram_scope_target" CHECK (("diagrams"."scopeType" = 'project' and num_nonnulls("diagrams"."taskId", "diagrams"."moduleId", "diagrams"."featureId") = 0) or ("diagrams"."scopeType" = 'task' and "diagrams"."taskId" is not null and num_nonnulls("diagrams"."taskId", "diagrams"."moduleId", "diagrams"."featureId") = 1) or ("diagrams"."scopeType" = 'module' and "diagrams"."moduleId" is not null and num_nonnulls("diagrams"."taskId", "diagrams"."moduleId", "diagrams"."featureId") = 1) or ("diagrams"."scopeType" = 'feature' and "diagrams"."featureId" is not null and num_nonnulls("diagrams"."taskId", "diagrams"."moduleId", "diagrams"."featureId") = 1))
);
--> statement-breakpoint
ALTER TABLE "diagrams" ADD CONSTRAINT "diagrams_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagrams" ADD CONSTRAINT "diagrams_taskId_projectId_tasks_id_projectId_fk" FOREIGN KEY ("taskId","projectId") REFERENCES "tasks"("id","projectId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagrams" ADD CONSTRAINT "diagrams_moduleId_projectId_modules_id_projectId_fk" FOREIGN KEY ("moduleId","projectId") REFERENCES "modules"("id","projectId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagrams" ADD CONSTRAINT "diagrams_featureId_projectId_features_id_projectId_fk" FOREIGN KEY ("featureId","projectId") REFERENCES "features"("id","projectId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "diagram_scope" ON "diagrams" USING btree ("projectId","scopeType","taskId","moduleId","featureId");--> statement-breakpoint
CREATE UNIQUE INDEX "diagram_public_token" ON "diagrams" USING btree ("publicToken");