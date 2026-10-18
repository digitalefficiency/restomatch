-- Credential auth (Epic B): password (argon2id) storage + reset tokens + 2FA scaffolding.
--
-- Hand-authored to match 0014–0018 (the drizzle snapshot chain on this branch
-- stops at 0013; do NOT run drizzle-kit generate against it). Purely additive:
-- three new IDENTITY tables, safe online (brief ACCESS EXCLUSIVE on create).
--
-- ⚠ MERGE NOTE: this index (0019) COLLIDES with the parallel 0019 security stack
-- (#2/#4/#6). Renumber to the next free index on merge and update _journal.json.
--
-- These tables are an identity trust zone (no restaurant_id). They are REVOKE'd
-- in full from the tenant app role (restomatch_app) in packages/db/src/rls.ts
-- and in drizzle/rls/0002_core_tenant_rls.sql — every read/write goes through
-- the OWNER auth connection. password_hash holds an argon2id PHC string,
-- totp_secret_enc holds AES-256-GCM ciphertext; neither ever stores plaintext.
-- token_hash / code_hash store sha256(raw) hex (the invitations pattern), so a
-- DB/log leak cannot replay a reset link or a recovery code.
CREATE TABLE "user_credentials" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"password_hash" text,
	"password_updated_at" timestamp with time zone,
	"token_version" integer DEFAULT 0 NOT NULL,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"totp_secret_enc" text,
	"totp_enabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "user_recovery_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" varchar(64) NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "user_credentials" ADD CONSTRAINT "user_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_recovery_codes" ADD CONSTRAINT "user_recovery_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_unique" ON "password_reset_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "password_reset_tokens_user_idx" ON "password_reset_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_recovery_codes_user_code_unique" ON "user_recovery_codes" USING btree ("user_id","code_hash");--> statement-breakpoint
CREATE INDEX "user_recovery_codes_user_idx" ON "user_recovery_codes" USING btree ("user_id");
