-- Preview persistence is metadata-only and additive. Runtime payloads remain outside the
-- database: no artifact content, host path, container identifier, port, raw log or clear ticket
-- is represented by this schema. Historical executions intentionally receive no preview rows.

CREATE TABLE "PreviewArtifact" (
    "artifactId" TEXT NOT NULL PRIMARY KEY,
    "executionRecordId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "artifactVersion" TEXT NOT NULL,
    "contractVersion" TEXT NOT NULL,
    "hashAlgorithm" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "exporterVersion" TEXT NOT NULL,
    "fileCount" INTEGER NOT NULL,
    "totalBytes" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL,
    "approvedAt" DATETIME,
    "expiresAt" DATETIME NOT NULL,
    "consumedAt" DATETIME,
    "deletedAt" DATETIME,
    "workspaceHash" TEXT NOT NULL,
    "sandboxRequestHash" TEXT NOT NULL,
    "factoryResultHash" TEXT,
    "sandboxResultHash" TEXT,
    "artifactContentHash" TEXT NOT NULL,
    "artifactHash" TEXT NOT NULL,
    "approvalHash" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "PreviewArtifact_executionRecordId_fkey" FOREIGN KEY ("executionRecordId") REFERENCES "ExecutionRecord" ("storageId") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "PreviewSession" (
    "previewId" TEXT NOT NULL PRIMARY KEY,
    "executionRecordId" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "health" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "artifactProfileId" TEXT NOT NULL,
    "artifactFileCount" INTEGER NOT NULL,
    "artifactTotalBytes" INTEGER NOT NULL,
    "artifactExpiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL,
    "startedAt" DATETIME,
    "expiresAt" DATETIME NOT NULL,
    "stoppingAt" DATETIME,
    "stoppedAt" DATETIME,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "ttlSeconds" INTEGER NOT NULL,
    "startupTimeoutMs" INTEGER NOT NULL,
    "healthTimeoutMs" INTEGER NOT NULL,
    "stopTimeoutMs" INTEGER NOT NULL,
    "cpus" REAL NOT NULL,
    "memoryBytes" INTEGER NOT NULL,
    "pidsLimit" INTEGER NOT NULL,
    "openFilesLimit" INTEGER NOT NULL,
    "temporaryBytes" INTEGER NOT NULL,
    "artifactBytes" INTEGER NOT NULL,
    "artifactFiles" INTEGER NOT NULL,
    "responseBytes" INTEGER NOT NULL,
    "responseTimeoutMs" INTEGER NOT NULL,
    "capturedLogBytes" INTEGER NOT NULL,
    "maxLogLineBytes" INTEGER NOT NULL,
    "factoryResultHash" TEXT NOT NULL,
    "sandboxRequestHash" TEXT NOT NULL,
    "sandboxResultHash" TEXT NOT NULL,
    "workspaceHash" TEXT NOT NULL,
    "artifactHash" TEXT NOT NULL,
    "artifactApprovalHash" TEXT NOT NULL,
    "policyHash" TEXT NOT NULL,
    "limitsHash" TEXT NOT NULL,
    "previewRequestHash" TEXT NOT NULL,
    "lineageHash" TEXT NOT NULL,
    "provenanceHash" TEXT NOT NULL,
    "previewSessionHash" TEXT NOT NULL,
    "failureCode" TEXT,
    "failureStage" TEXT,
    "failureSourceCode" TEXT,
    CONSTRAINT "PreviewSession_executionRecordId_fkey" FOREIGN KEY ("executionRecordId") REFERENCES "ExecutionRecord" ("storageId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PreviewSession_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "PreviewArtifact" ("artifactId") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "PreviewSessionEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "previewSessionId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "event" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "occurredAt" DATETIME NOT NULL,
    "durationMs" INTEGER,
    "artifactHash" TEXT NOT NULL,
    "previewRequestHash" TEXT NOT NULL,
    "previewSessionHash" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "failureCode" TEXT,
    "contractVersion" TEXT NOT NULL,
    CONSTRAINT "PreviewSessionEvent_previewSessionId_fkey" FOREIGN KEY ("previewSessionId") REFERENCES "PreviewSession" ("previewId") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "PreviewSessionProvenance" (
    "previewSessionId" TEXT NOT NULL PRIMARY KEY,
    "runnerVersion" TEXT NOT NULL,
    "contractVersion" TEXT NOT NULL,
    "hashAlgorithm" TEXT NOT NULL,
    "artifactVersion" TEXT NOT NULL,
    "artifactContractVersion" TEXT NOT NULL,
    "exporterVersion" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "policyHash" TEXT NOT NULL,
    "limitsHash" TEXT NOT NULL,
    "runtimeAdapter" TEXT,
    "runtimeEngineName" TEXT,
    "runtimeEngineVersion" TEXT,
    "runtimeImageReference" TEXT,
    "runtimeImageDigest" TEXT,
    "runtimeImageId" TEXT,
    "runtimePlatform" TEXT,
    "runtimeName" TEXT,
    "runtimeVersion" TEXT,
    "runtimeServerAbiVersion" TEXT,
    CONSTRAINT "PreviewSessionProvenance_previewSessionId_fkey" FOREIGN KEY ("previewSessionId") REFERENCES "PreviewSession" ("previewId") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "PreviewAccessTicket" (
    "previewSessionId" TEXT NOT NULL PRIMARY KEY,
    "ticketHash" TEXT NOT NULL,
    "issuedAt" DATETIME NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "consumedAt" DATETIME,
    "revokedAt" DATETIME,
    CONSTRAINT "PreviewAccessTicket_previewSessionId_fkey" FOREIGN KEY ("previewSessionId") REFERENCES "PreviewSession" ("previewId") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PreviewArtifact_artifactHash_key" ON "PreviewArtifact"("artifactHash");
CREATE UNIQUE INDEX "PreviewArtifact_approvalHash_key" ON "PreviewArtifact"("approvalHash");
CREATE INDEX "PreviewArtifact_executionRecordId_createdAt_idx" ON "PreviewArtifact"("executionRecordId", "createdAt");
CREATE INDEX "PreviewArtifact_status_expiresAt_idx" ON "PreviewArtifact"("status", "expiresAt");
CREATE INDEX "PreviewArtifact_workspaceHash_idx" ON "PreviewArtifact"("workspaceHash");

CREATE UNIQUE INDEX "PreviewSession_executionRecordId_key" ON "PreviewSession"("executionRecordId");
CREATE UNIQUE INDEX "PreviewSession_artifactId_key" ON "PreviewSession"("artifactId");
CREATE INDEX "PreviewSession_status_expiresAt_idx" ON "PreviewSession"("status", "expiresAt");
CREATE INDEX "PreviewSession_createdAt_idx" ON "PreviewSession"("createdAt");
CREATE INDEX "PreviewSession_previewSessionHash_idx" ON "PreviewSession"("previewSessionHash");

CREATE UNIQUE INDEX "PreviewSessionEvent_previewSessionId_sequence_key" ON "PreviewSessionEvent"("previewSessionId", "sequence");
CREATE INDEX "PreviewSessionEvent_previewSessionId_occurredAt_idx" ON "PreviewSessionEvent"("previewSessionId", "occurredAt");
CREATE INDEX "PreviewSessionEvent_event_occurredAt_idx" ON "PreviewSessionEvent"("event", "occurredAt");

CREATE INDEX "PreviewSessionProvenance_policyId_policyVersion_idx" ON "PreviewSessionProvenance"("policyId", "policyVersion");
CREATE INDEX "PreviewSessionProvenance_runtimeImageDigest_idx" ON "PreviewSessionProvenance"("runtimeImageDigest");

CREATE UNIQUE INDEX "PreviewAccessTicket_ticketHash_key" ON "PreviewAccessTicket"("ticketHash");
CREATE INDEX "PreviewAccessTicket_expiresAt_idx" ON "PreviewAccessTicket"("expiresAt");
