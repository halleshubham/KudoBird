-- Row Level Security: tenant isolation enforced by Postgres, not just app code.
--
-- Request context is carried in transaction-local settings, set by
-- src/server/db.ts (withTenant / withPlatform):
--   app.org_id   uuid of the active organisation
--   app.user_id  uuid of the signed-in user
--   app.bypass   'on' only inside withPlatform() (super admin, workers, public pages)

CREATE FUNCTION app_org() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('app.org_id', true), '')::uuid $$;
CREATE FUNCTION app_user() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
CREATE FUNCTION app_bypass() RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT coalesce(current_setting('app.bypass', true), '') = 'on' $$;

-- Generic tenant tables: only rows of the active org are visible/writable.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['Invite','Subscription','UsageCounter','AuditLog'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (app_bypass() OR "orgId" = app_org()) WITH CHECK (app_bypass() OR "orgId" = app_org())', t);
  END LOOP;
END $$;

-- Membership: a user may also read their own memberships in any org
-- (needed to list and switch organisations). Writes need the active org.
ALTER TABLE "Membership" ENABLE ROW LEVEL SECURITY;
CREATE POLICY membership_read ON "Membership" FOR SELECT
  USING (app_bypass() OR "orgId" = app_org() OR "userId" = app_user());
CREATE POLICY membership_write ON "Membership" FOR ALL
  USING (app_bypass() OR "orgId" = app_org())
  WITH CHECK (app_bypass() OR "orgId" = app_org());

-- Organization: visible if active, or if the user is a member.
ALTER TABLE "Organization" ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_read ON "Organization" FOR SELECT
  USING (app_bypass() OR id = app_org()
         OR id IN (SELECT "orgId" FROM "Membership" WHERE "userId" = app_user()));
CREATE POLICY org_write ON "Organization" FOR ALL
  USING (app_bypass() OR id = app_org())
  WITH CHECK (app_bypass() OR id = app_org());

-- Privileges for the restricted application role.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kudobird_app') THEN
    GRANT USAGE ON SCHEMA public TO kudobird_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO kudobird_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO kudobird_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO kudobird_app;
  END IF;
END $$;
