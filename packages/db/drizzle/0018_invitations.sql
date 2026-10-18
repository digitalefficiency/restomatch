-- Team invitations: self-serve email invite → accept-on-login → membership.
--
-- Hand-authored to match 0014–0017 (the drizzle snapshot chain on this branch
-- stops at 0013; do NOT run drizzle-kit generate against it). Purely additive:
-- one new enum + one new table, safe online (brief ACCESS EXCLUSIVE on create).
--
-- token_hash stores sha256(raw token) hex; the raw token lives only in the
-- invite email link (never persisted) so a DB/log leak cannot replay invites.
-- The partial unique (restaurant_id,email) WHERE status='pending' blocks
-- duplicate pending invites while allowing re-invite after revoke/expiry/accept.
--
-- RLS: invitations carries restaurant_id and is added to the allowlist in
-- drizzle/rls/0002_core_tenant_rls.sql, so owners manage it under the tenant
-- GUC. The accept path runs on the RLS-bypassing auth connection (token+email
-- checks enforce safety there).
CREATE TYPE "public"."invitation_status" AS ENUM('pending', 'accepted', 'revoked', 'expired');--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "user_role" NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"status" "invitation_status" DEFAULT 'pending' NOT NULL,
	"invited_by_user_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_accepted_by_user_id_users_id_fk" FOREIGN KEY ("accepted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_token_hash_unique" ON "invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_pending_unique" ON "invitations" USING btree ("restaurant_id","email") WHERE "invitations"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "invitations_restaurant_idx" ON "invitations" USING btree ("restaurant_id","status");--> statement-breakpoint
CREATE INDEX "invitations_email_idx" ON "invitations" USING btree ("email");
