CREATE TYPE "public"."activity_event_type" AS ENUM('invoice_received', 'invoice_matched', 'discrepancy_approved', 'discrepancy_rejected', 'alias_learned', 'sync_completed');--> statement-breakpoint
CREATE TABLE "activity_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"event_type" "activity_event_type" NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"actor_id" uuid,
	"title" text NOT NULL,
	"detail" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_events_restaurant_created_idx" ON "activity_events" USING btree ("restaurant_id","created_at");