ALTER TABLE "ExecutionFactoryResult" ADD COLUMN "sandboxCleanupFailureCode" TEXT;
ALTER TABLE "ExecutionFactoryResult" ADD COLUMN "sandboxCleanupSourceCode" TEXT;

CREATE TABLE "FactoryTechnicalCheckpoint" (
    "checkpointHash" TEXT NOT NULL PRIMARY KEY,
    "executionRecordId" TEXT NOT NULL,
    "sourceExecutionId" TEXT NOT NULL,
    "checkpointVersion" TEXT NOT NULL,
    "bundleHash" TEXT NOT NULL,
    "profileValidationHash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL,
    CONSTRAINT "FactoryTechnicalCheckpoint_executionRecordId_fkey" FOREIGN KEY ("executionRecordId") REFERENCES "ExecutionRecord" ("storageId") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "FactoryTechnicalCheckpointCleanup" (
    "checkpointHash" TEXT NOT NULL PRIMARY KEY,
    "factoryResultHash" TEXT NOT NULL,
    "releaseStatus" TEXT NOT NULL,
    "completedAt" DATETIME NOT NULL,
    CONSTRAINT "FactoryTechnicalCheckpointCleanup_checkpointHash_fkey" FOREIGN KEY ("checkpointHash") REFERENCES "FactoryTechnicalCheckpoint" ("checkpointHash") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "FactoryTechnicalResumeAttempt" (
    "attemptId" TEXT NOT NULL PRIMARY KEY,
    "checkpointHash" TEXT NOT NULL,
    "activeCheckpointHash" TEXT,
    "ownerId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL,
    "finishedAt" DATETIME,
    "resultHash" TEXT,
    "result" JSONB,
    "cleanupConfirmed" BOOLEAN NOT NULL,
    "failureReasonCode" TEXT,
    CONSTRAINT "FactoryTechnicalResumeAttempt_checkpointHash_fkey" FOREIGN KEY ("checkpointHash") REFERENCES "FactoryTechnicalCheckpoint" ("checkpointHash") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "FactoryTechnicalCheckpoint_executionRecordId_key" ON "FactoryTechnicalCheckpoint"("executionRecordId");
CREATE UNIQUE INDEX "FactoryTechnicalCheckpoint_sourceExecutionId_key" ON "FactoryTechnicalCheckpoint"("sourceExecutionId");
CREATE INDEX "FactoryTechnicalCheckpoint_createdAt_idx" ON "FactoryTechnicalCheckpoint"("createdAt");
CREATE INDEX "FactoryTechnicalCheckpoint_bundleHash_idx" ON "FactoryTechnicalCheckpoint"("bundleHash");
CREATE INDEX "FactoryTechnicalCheckpointCleanup_factoryResultHash_idx" ON "FactoryTechnicalCheckpointCleanup"("factoryResultHash");
CREATE INDEX "FactoryTechnicalCheckpointCleanup_completedAt_idx" ON "FactoryTechnicalCheckpointCleanup"("completedAt");
CREATE UNIQUE INDEX "FactoryTechnicalResumeAttempt_activeCheckpointHash_key" ON "FactoryTechnicalResumeAttempt"("activeCheckpointHash");
CREATE INDEX "FactoryTechnicalResumeAttempt_checkpointHash_startedAt_idx" ON "FactoryTechnicalResumeAttempt"("checkpointHash", "startedAt");
CREATE INDEX "FactoryTechnicalResumeAttempt_ownerId_status_startedAt_idx" ON "FactoryTechnicalResumeAttempt"("ownerId", "status", "startedAt");
CREATE INDEX "FactoryTechnicalResumeAttempt_requestId_idx" ON "FactoryTechnicalResumeAttempt"("requestId");
