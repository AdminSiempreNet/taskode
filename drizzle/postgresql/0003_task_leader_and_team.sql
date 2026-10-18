ALTER TABLE "tasks" RENAME COLUMN "assigneeId" TO "leaderId";
--> statement-breakpoint
ALTER TABLE "tasks" RENAME CONSTRAINT "tasks_assigneeId_user_id_fk" TO "tasks_leaderId_user_id_fk";
--> statement-breakpoint
ALTER TABLE "task_collaborators" RENAME TO "task_team_members";
--> statement-breakpoint
ALTER TABLE "task_team_members" RENAME CONSTRAINT "task_collaborators_taskId_userId_pk" TO "task_team_members_taskId_userId_pk";
--> statement-breakpoint
ALTER TABLE "task_team_members" RENAME CONSTRAINT "task_collaborators_taskId_tasks_id_fk" TO "task_team_members_taskId_tasks_id_fk";
--> statement-breakpoint
ALTER TABLE "task_team_members" RENAME CONSTRAINT "task_collaborators_userId_user_id_fk" TO "task_team_members_userId_user_id_fk";
--> statement-breakpoint
ALTER INDEX "collaborator_user" RENAME TO "team_member_user";
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'tasks'::regclass AND conname = 'tasks_assigneeId_not_null') THEN
    ALTER TABLE "tasks" RENAME CONSTRAINT "tasks_assigneeId_not_null" TO "tasks_leaderId_not_null";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'task_team_members'::regclass AND conname = 'task_collaborators_taskId_not_null') THEN
    ALTER TABLE "task_team_members" RENAME CONSTRAINT "task_collaborators_taskId_not_null" TO "task_team_members_taskId_not_null";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'task_team_members'::regclass AND conname = 'task_collaborators_userId_not_null') THEN
    ALTER TABLE "task_team_members" RENAME CONSTRAINT "task_collaborators_userId_not_null" TO "task_team_members_userId_not_null";
  END IF;
END $$;
