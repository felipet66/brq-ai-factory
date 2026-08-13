ALTER TABLE "FactoryTechnicalResumeAttempt" ADD COLUMN "activePhase" TEXT;
ALTER TABLE "FactoryTechnicalResumeAttempt" ADD COLUMN "leaseId" TEXT;
ALTER TABLE "FactoryTechnicalResumeAttempt" ADD COLUMN "leaseVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "FactoryTechnicalResumeAttempt" ADD COLUMN "heartbeatAt" DATETIME;
ALTER TABLE "FactoryTechnicalResumeAttempt" ADD COLUMN "leaseExpiresAt" DATETIME;
ALTER TABLE "FactoryTechnicalResumeAttempt" ADD COLUMN "pendingResultHash" TEXT;
ALTER TABLE "FactoryTechnicalResumeAttempt" ADD COLUMN "pendingResult" JSONB;
ALTER TABLE "FactoryTechnicalResumeAttempt" ADD COLUMN "pendingRecordedAt" DATETIME;
ALTER TABLE "FactoryTechnicalResumeAttempt" ADD COLUMN "recoveryReasonCode" TEXT;

UPDATE "FactoryTechnicalResumeAttempt"
SET "activePhase" = 'RECOVERY_REQUIRED',
    "recoveryReasonCode" = 'TECHNICAL_LEGACY_ATTEMPT_RECOVERY_REQUIRED'
WHERE "status" = 'RUNNING' AND "activeCheckpointHash" IS NOT NULL;

CREATE INDEX "FactoryTechnicalResumeAttempt_status_leaseExpiresAt_idx"
ON "FactoryTechnicalResumeAttempt"("status", "leaseExpiresAt");
