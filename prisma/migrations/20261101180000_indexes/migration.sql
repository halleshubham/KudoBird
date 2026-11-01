-- CreateIndex
CREATE INDEX "Certificate_renderStatus_issuedAt_idx" ON "Certificate"("renderStatus", "issuedAt");

-- CreateIndex
CREATE INDEX "Certificate_issuedAt_idx" ON "Certificate"("issuedAt");

-- CreateIndex
CREATE INDEX "Entry_campaignId_createdAt_idx" ON "Entry"("campaignId", "createdAt");

-- CreateIndex
CREATE INDEX "Entry_orgId_status_idx" ON "Entry"("orgId", "status");

