-- CreateEnum
CREATE TYPE "CertificateStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "RenderStatus" AS ENUM ('QUEUED', 'RENDERING', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "Certificate" (
    "id" UUID NOT NULL,
    "publicId" TEXT NOT NULL,
    "orgId" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "entryId" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "number" TEXT NOT NULL,
    "templateVersionId" UUID NOT NULL,
    "renderData" JSONB NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "status" "CertificateStatus" NOT NULL DEFAULT 'ACTIVE',
    "revokedAt" TIMESTAMP(3),
    "revokeReason" TEXT,
    "renderStatus" "RenderStatus" NOT NULL DEFAULT 'QUEUED',
    "renderError" TEXT,
    "outputs" JSONB NOT NULL DEFAULT '{}',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Certificate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Certificate_publicId_key" ON "Certificate"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "Certificate_entryId_key" ON "Certificate"("entryId");

-- CreateIndex
CREATE INDEX "Certificate_orgId_issuedAt_idx" ON "Certificate"("orgId", "issuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Certificate_campaignId_number_key" ON "Certificate"("campaignId", "number");

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "Entry"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "Certificate" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Certificate"
  USING (app_bypass() OR "orgId" = app_org()) WITH CHECK (app_bypass() OR "orgId" = app_org());
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kudobird_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO kudobird_app;
  END IF;
END $$;
