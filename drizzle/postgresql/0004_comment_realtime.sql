CREATE TABLE "comment_outbox" (
	"taskId" text PRIMARY KEY NOT NULL,
	"eventId" text DEFAULT gen_random_uuid()::text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"availableAt" timestamp with time zone DEFAULT now() NOT NULL,
	"leaseUntil" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "comment_outbox_available" ON "comment_outbox" USING btree ("availableAt");
--> statement-breakpoint
CREATE FUNCTION taskode_queue_comment_change() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE affected_task text;
BEGIN
  IF TG_OP = 'DELETE' THEN affected_task := OLD."taskId";
  ELSE affected_task := NEW."taskId"; END IF;
  INSERT INTO comment_outbox ("taskId", "eventId")
  VALUES (affected_task, gen_random_uuid()::text)
  ON CONFLICT ("taskId") DO UPDATE SET
    "eventId" = excluded."eventId", attempts = 0,
    "availableAt" = now(), "leaseUntil" = null;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER taskode_comment_changed AFTER INSERT OR UPDATE OR DELETE ON comments
FOR EACH ROW EXECUTE FUNCTION taskode_queue_comment_change();
