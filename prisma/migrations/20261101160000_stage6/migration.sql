-- AlterEnum
ALTER TYPE "EmailKind" ADD VALUE 'SUPPORT_ACCESS';

-- CreateTable
CREATE TABLE "ImpersonationLog" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "adminId" UUID NOT NULL,
    "adminEmail" TEXT NOT NULL,
    "targetUserId" UUID NOT NULL,
    "targetEmail" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "ImpersonationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformAudit" (
    "id" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT,
    "entityId" TEXT,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImpersonationLog_orgId_startedAt_idx" ON "ImpersonationLog"("orgId", "startedAt");

-- CreateIndex
CREATE INDEX "PlatformAudit_createdAt_idx" ON "PlatformAudit"("createdAt");

-- AddForeignKey
ALTER TABLE "ImpersonationLog" ADD CONSTRAINT "ImpersonationLog_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "ImpersonationLog" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ImpersonationLog"
  USING (app_bypass() OR "orgId" = app_org()) WITH CHECK (app_bypass() OR "orgId" = app_org());
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kudobird_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO kudobird_app;
  END IF;
END $$;
