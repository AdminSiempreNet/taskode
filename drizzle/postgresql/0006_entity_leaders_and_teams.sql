ALTER TABLE "projects" RENAME COLUMN "ownerId" TO "leaderId";
--> statement-breakpoint
ALTER TABLE "projects" RENAME CONSTRAINT "projects_ownerId_user_id_fk" TO "projects_leaderId_user_id_fk";
--> statement-breakpoint
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'projects'::regclass AND conname = 'projects_ownerId_not_null') THEN ALTER TABLE "projects" RENAME CONSTRAINT "projects_ownerId_not_null" TO "projects_leaderId_not_null"; END IF; END $$;
--> statement-breakpoint
ALTER TABLE "modules" RENAME COLUMN "ownerId" TO "leaderId";
--> statement-breakpoint
ALTER TABLE "modules" RENAME CONSTRAINT "modules_ownerId_user_id_fk" TO "modules_leaderId_user_id_fk";
--> statement-breakpoint
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'modules'::regclass AND conname = 'modules_ownerId_not_null') THEN ALTER TABLE "modules" RENAME CONSTRAINT "modules_ownerId_not_null" TO "modules_leaderId_not_null"; END IF; END $$;
--> statement-breakpoint
ALTER TABLE "features" RENAME COLUMN "ownerId" TO "leaderId";
--> statement-breakpoint
ALTER TABLE "features" RENAME CONSTRAINT "features_ownerId_user_id_fk" TO "features_leaderId_user_id_fk";
--> statement-breakpoint
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'features'::regclass AND conname = 'features_ownerId_not_null') THEN ALTER TABLE "features" RENAME CONSTRAINT "features_ownerId_not_null" TO "features_leaderId_not_null"; END IF; END $$;
--> statement-breakpoint
ALTER INDEX "project_owner" RENAME TO "project_leader";
--> statement-breakpoint
ALTER TABLE "project_members" RENAME TO "project_team_members";
--> statement-breakpoint
ALTER TABLE "project_team_members" RENAME CONSTRAINT "project_members_projectId_userId_pk" TO "project_team_members_projectId_userId_pk";
--> statement-breakpoint
ALTER TABLE "project_team_members" RENAME CONSTRAINT "project_members_projectId_projects_id_fk" TO "project_team_members_projectId_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "project_team_members" RENAME CONSTRAINT "project_members_userId_user_id_fk" TO "project_team_members_userId_user_id_fk";
--> statement-breakpoint
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'project_team_members'::regclass AND conname = 'project_members_projectId_not_null') THEN ALTER TABLE "project_team_members" RENAME CONSTRAINT "project_members_projectId_not_null" TO "project_team_members_projectId_not_null"; END IF; END $$;
--> statement-breakpoint
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'project_team_members'::regclass AND conname = 'project_members_userId_not_null') THEN ALTER TABLE "project_team_members" RENAME CONSTRAINT "project_members_userId_not_null" TO "project_team_members_userId_not_null"; END IF; END $$;
--> statement-breakpoint
ALTER INDEX "membership_user" RENAME TO "project_team_user";
--> statement-breakpoint
CREATE TABLE "feature_team_members" (
	"featureId" text NOT NULL,
	"userId" text NOT NULL,
	CONSTRAINT "feature_team_members_featureId_userId_pk" PRIMARY KEY("featureId","userId")
);

--> statement-breakpoint
CREATE TABLE "module_team_members" (
	"moduleId" text NOT NULL,
	"userId" text NOT NULL,
	CONSTRAINT "module_team_members_moduleId_userId_pk" PRIMARY KEY("moduleId","userId")
);

--> statement-breakpoint
ALTER TABLE "feature_team_members" ADD CONSTRAINT "feature_team_members_featureId_features_id_fk" FOREIGN KEY ("featureId") REFERENCES "features"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "feature_team_members" ADD CONSTRAINT "feature_team_members_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "module_team_members" ADD CONSTRAINT "module_team_members_moduleId_modules_id_fk" FOREIGN KEY ("moduleId") REFERENCES "modules"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "module_team_members" ADD CONSTRAINT "module_team_members_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "feature_team_user" ON "feature_team_members" USING btree ("userId");
--> statement-breakpoint
CREATE INDEX "module_team_user" ON "module_team_members" USING btree ("userId");
