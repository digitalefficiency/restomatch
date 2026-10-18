-- 0039_invitation_locale (S4 auth-admin, client-ready sprint)
--
-- invitations.preferred_locale – the app language ('he' | 'en') the inviter chose
--   for the invitee (e.g. an English-speaking receiver). Drives the invite email's
--   language and is copied onto memberships.preferred_locale (0028) when the
--   invite is accepted, so the invitee's first login is already in their language.
--   NULL = no preference (Hebrew default). Display-only; no money/matching effect.
ALTER TABLE "invitations" ADD COLUMN IF NOT EXISTS "preferred_locale" varchar(8);--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invitations_preferred_locale_check') THEN
    ALTER TABLE "invitations"
      ADD CONSTRAINT "invitations_preferred_locale_check"
      CHECK ("preferred_locale" IS NULL OR "preferred_locale" IN ('he', 'en'));
  END IF;
END $$;
