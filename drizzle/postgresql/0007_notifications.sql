CREATE TABLE "notification_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"recipientId" text NOT NULL,
	"notificationId" text,
	"subscriptionId" text,
	"transport" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"availableAt" timestamp with time zone DEFAULT now() NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"leaseUntil" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"userId" text PRIMARY KEY NOT NULL,
	"offsets" jsonb DEFAULT '["1440","60"]'::jsonb NOT NULL,
	"dateOnlyTime" text DEFAULT '08:00' NOT NULL,
	CONSTRAINT "reminder_time" CHECK ("notification_preferences"."dateOnlyTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"recipientId" text NOT NULL,
	"actorId" text,
	"taskId" text NOT NULL,
	"type" text NOT NULL,
	"taskTitle" text NOT NULL,
	"offsetMinutes" integer,
	"dedupKey" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"readAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"sessionId" text NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_reminders" (
	"id" text PRIMARY KEY NOT NULL,
	"taskId" text NOT NULL,
	"userId" text NOT NULL,
	"offsetMinutes" integer NOT NULL,
	"scheduledFor" timestamp with time zone NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"dedupKey" text NOT NULL,
	"processedAt" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "timeZone" text DEFAULT 'America/Bogota' NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_recipientId_user_id_fk" FOREIGN KEY ("recipientId") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notificationId_notifications_id_fk" FOREIGN KEY ("notificationId") REFERENCES "notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_subscriptionId_push_subscriptions_id_fk" FOREIGN KEY ("subscriptionId") REFERENCES "push_subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipientId_user_id_fk" FOREIGN KEY ("recipientId") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actorId_user_id_fk" FOREIGN KEY ("actorId") REFERENCES "user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_taskId_tasks_id_fk" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_sessionId_session_id_fk" FOREIGN KEY ("sessionId") REFERENCES "session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_reminders" ADD CONSTRAINT "task_reminders_taskId_tasks_id_fk" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_reminders" ADD CONSTRAINT "task_reminders_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_delivery_pending" ON "notification_deliveries" USING btree ("availableAt");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_dedup" ON "notifications" USING btree ("dedupKey");--> statement-breakpoint
CREATE INDEX "notification_inbox" ON "notifications" USING btree ("recipientId","createdAt","id");--> statement-breakpoint
CREATE INDEX "notification_unread" ON "notifications" USING btree ("recipientId") WHERE "notifications"."readAt" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "push_endpoint" ON "push_subscriptions" USING btree ("endpoint");--> statement-breakpoint
CREATE INDEX "push_user" ON "push_subscriptions" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "reminder_dedup" ON "task_reminders" USING btree ("dedupKey");--> statement-breakpoint
CREATE INDEX "reminder_pending" ON "task_reminders" USING btree ("scheduledFor") WHERE "task_reminders"."processedAt" is null;