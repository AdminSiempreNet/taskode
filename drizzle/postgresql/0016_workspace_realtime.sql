CREATE TABLE "workspace_outbox" (
	"projectId" text PRIMARY KEY NOT NULL,
	"eventId" text DEFAULT gen_random_uuid()::text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"availableAt" timestamp with time zone DEFAULT now() NOT NULL,
	"leaseUntil" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "workspace_outbox_available" ON "workspace_outbox" USING btree ("availableAt");--> statement-breakpoint
CREATE FUNCTION taskode_queue_workspace_change() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  INSERT INTO workspace_outbox ("projectId", "eventId")
  VALUES (CASE WHEN TG_OP = 'DELETE' THEN OLD."projectId" ELSE NEW."projectId" END, gen_random_uuid()::text)
  ON CONFLICT ("projectId") DO UPDATE SET
    "eventId" = excluded."eventId", attempts = 0, "availableAt" = now(), "leaseUntil" = null;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
-- Deferred to commit: the shared outbox row is locked after every task row the
-- transaction touches, so two concurrent moves in one column cannot deadlock on it.
CREATE CONSTRAINT TRIGGER taskode_task_written AFTER INSERT OR DELETE ON tasks
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION taskode_queue_workspace_change();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER taskode_task_updated AFTER UPDATE ON tasks
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*)
EXECUTE FUNCTION taskode_queue_workspace_change();
