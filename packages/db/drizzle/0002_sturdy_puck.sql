CREATE TYPE "public"."notification_channel" AS ENUM('whatsapp', 'push', 'email');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('queued', 'sent', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "notifications_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"target" text NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"payload" jsonb DEFAULT NULL,
	"status" "notification_status" DEFAULT 'queued' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"scheduled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"related_entity_type" text,
	"related_entity_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notifications_outbox" ADD CONSTRAINT "notifications_outbox_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_status_scheduled_idx" ON "notifications_outbox" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE INDEX "notifications_related_idx" ON "notifications_outbox" USING btree ("related_entity_type","related_entity_id");