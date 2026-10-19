CREATE TABLE "feature_clients" (
	"featureId" text NOT NULL,
	"clientId" text NOT NULL,
	CONSTRAINT "feature_clients_featureId_clientId_pk" PRIMARY KEY("featureId","clientId")
);
--> statement-breakpoint
CREATE TABLE "feature_tickets" (
	"featureId" text NOT NULL,
	"ticketId" text NOT NULL,
	CONSTRAINT "feature_tickets_featureId_ticketId_pk" PRIMARY KEY("featureId","ticketId")
);
--> statement-breakpoint
CREATE TABLE "module_clients" (
	"moduleId" text NOT NULL,
	"clientId" text NOT NULL,
	CONSTRAINT "module_clients_moduleId_clientId_pk" PRIMARY KEY("moduleId","clientId")
);
--> statement-breakpoint
CREATE TABLE "module_tickets" (
	"moduleId" text NOT NULL,
	"ticketId" text NOT NULL,
	CONSTRAINT "module_tickets_moduleId_ticketId_pk" PRIMARY KEY("moduleId","ticketId")
);
--> statement-breakpoint
CREATE TABLE "project_clients" (
	"projectId" text NOT NULL,
	"clientId" text NOT NULL,
	CONSTRAINT "project_clients_projectId_clientId_pk" PRIMARY KEY("projectId","clientId")
);
--> statement-breakpoint
CREATE TABLE "project_tickets" (
	"projectId" text NOT NULL,
	"ticketId" text NOT NULL,
	CONSTRAINT "project_tickets_projectId_ticketId_pk" PRIMARY KEY("projectId","ticketId")
);
--> statement-breakpoint
CREATE TABLE "task_tickets" (
	"taskId" text NOT NULL,
	"ticketId" text NOT NULL,
	CONSTRAINT "task_tickets_taskId_ticketId_pk" PRIMARY KEY("taskId","ticketId")
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" text PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"url" text,
	"clientId" text,
	"createdAt" text NOT NULL,
	"updatedAt" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "feature_clients" ADD CONSTRAINT "feature_clients_featureId_features_id_fk" FOREIGN KEY ("featureId") REFERENCES "features"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_clients" ADD CONSTRAINT "feature_clients_clientId_clients_id_fk" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_tickets" ADD CONSTRAINT "feature_tickets_featureId_features_id_fk" FOREIGN KEY ("featureId") REFERENCES "features"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_tickets" ADD CONSTRAINT "feature_tickets_ticketId_tickets_id_fk" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "module_clients" ADD CONSTRAINT "module_clients_moduleId_modules_id_fk" FOREIGN KEY ("moduleId") REFERENCES "modules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "module_clients" ADD CONSTRAINT "module_clients_clientId_clients_id_fk" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "module_tickets" ADD CONSTRAINT "module_tickets_moduleId_modules_id_fk" FOREIGN KEY ("moduleId") REFERENCES "modules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "module_tickets" ADD CONSTRAINT "module_tickets_ticketId_tickets_id_fk" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_clients" ADD CONSTRAINT "project_clients_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_clients" ADD CONSTRAINT "project_clients_clientId_clients_id_fk" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_tickets" ADD CONSTRAINT "project_tickets_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_tickets" ADD CONSTRAINT "project_tickets_ticketId_tickets_id_fk" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_tickets" ADD CONSTRAINT "task_tickets_taskId_tasks_id_fk" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_tickets" ADD CONSTRAINT "task_tickets_ticketId_tickets_id_fk" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_clientId_clients_id_fk" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feature_clients_client" ON "feature_clients" USING btree ("clientId");--> statement-breakpoint
CREATE INDEX "feature_tickets_ticket" ON "feature_tickets" USING btree ("ticketId");--> statement-breakpoint
CREATE INDEX "module_clients_client" ON "module_clients" USING btree ("clientId");--> statement-breakpoint
CREATE INDEX "module_tickets_ticket" ON "module_tickets" USING btree ("ticketId");--> statement-breakpoint
CREATE INDEX "project_clients_client" ON "project_clients" USING btree ("clientId");--> statement-breakpoint
CREATE INDEX "project_tickets_ticket" ON "project_tickets" USING btree ("ticketId");--> statement-breakpoint
CREATE INDEX "task_tickets_ticket" ON "task_tickets" USING btree ("ticketId");--> statement-breakpoint
CREATE INDEX "ticket_client" ON "tickets" USING btree ("clientId");--> statement-breakpoint
CREATE INDEX "ticket_number" ON "tickets" USING btree ("number");--> statement-breakpoint
-- One independent record per task: matching numbers are intentionally not merged.
INSERT INTO "tickets" ("id", "number", "description", "url", "clientId", "createdAt", "updatedAt")
SELECT 'legacy-ticket:' || md5(t.id), btrim(t."ticketNumber"), '', NULL,
       (SELECT CASE WHEN count(*) = 1 THEN min(tc."clientId") ELSE NULL END FROM "task_clients" tc WHERE tc."taskId" = t.id),
       t."createdAt", t."updatedAt"
FROM "tasks" t WHERE nullif(btrim(t."ticketNumber"), '') IS NOT NULL;
--> statement-breakpoint
INSERT INTO "task_tickets" ("taskId", "ticketId")
SELECT id, 'legacy-ticket:' || md5(id) FROM "tasks" WHERE nullif(btrim("ticketNumber"), '') IS NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
  IF (SELECT count(*) FROM "tasks" WHERE nullif(btrim("ticketNumber"), '') IS NOT NULL)
     <> (SELECT count(*) FROM "task_tickets") THEN
    RAISE EXCEPTION 'La conversión de tickets está incompleta';
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN "ticketNumber";