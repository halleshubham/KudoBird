-- CreateEnum
CREATE TYPE "NotifyMode" AS ENUM ('INSTANT', 'DAILY', 'OFF');

-- CreateEnum
CREATE TYPE "EmailKind" AS ENUM ('CERTIFICATE', 'REJECTED', 'ADMIN_ENTRY', 'ADMIN_DIGEST');

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'DELAYED', 'BOUNCED', 'COMPLAINED', 'FAILED', 'SUPPRESSED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('VIEW', 'SHARE');

-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "entryNotifications" "NotifyMode" NOT NULL DEFAULT 'DAILY';

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "emailDomainVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "emailFrom" TEXT;

-- CreateTable
CREATE TABLE "EmailLog" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "entryId" UUID,
    "certificateId" UUID,
    "kind" "EmailKind" NOT NULL,
    "toMasked" TEXT NOT NULL,
    "status" "EmailStatus" NOT NULL DEFAULT 'QUEUED',
    "providerId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Suppression" (
    "id" UUID NOT NULL,
    "emailHash" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Suppression_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CertificateEvent" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "certificateId" UUID NOT NULL,
    "type" "EventType" NOT NULL,
    "platform" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CertificateEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessedWebhook" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedWebhook_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailLog_providerId_key" ON "EmailLog"("providerId");

-- CreateIndex
CREATE INDEX "EmailLog_entryId_idx" ON "EmailLog"("entryId");

-- CreateIndex
CREATE INDEX "EmailLog_orgId_createdAt_idx" ON "EmailLog"("orgId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Suppression_emailHash_key" ON "Suppression"("emailHash");

-- CreateIndex
CREATE INDEX "CertificateEvent_orgId_campaignId_type_platform_idx" ON "CertificateEvent"("orgId", "campaignId", "type", "platform");

-- CreateIndex
CREATE INDEX "CertificateEvent_certificateId_idx" ON "CertificateEvent"("certificateId");

-- AddForeignKey
ALTER TABLE "EmailLog" ADD CONSTRAINT "EmailLog_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CertificateEvent" ADD CONSTRAINT "CertificateEvent_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;


DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['EmailLog','CertificateEvent'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (app_bypass() OR "orgId" = app_org()) WITH CHECK (app_bypass() OR "orgId" = app_org())', t);
  END LOOP;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kudobird_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO kudobird_app;
  END IF;
END $$;
