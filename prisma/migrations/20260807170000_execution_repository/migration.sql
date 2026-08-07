-- CreateTable
CREATE TABLE "ExecutionRecord" (
    "storageId" TEXT NOT NULL PRIMARY KEY,
    "workflowId" TEXT NOT NULL,
    "executionId" TEXT,
    "requestId" TEXT,
    "traceId" TEXT,
    "projectName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "workflowStatus" TEXT,
    "readiness" TEXT,
    "createdAt" DATETIME NOT NULL,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "durationMs" INTEGER,
    "engineVersion" TEXT NOT NULL,
    "contractVersion" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "failureKind" TEXT,
    "failureCode" TEXT,
    "failureSourceCode" TEXT
);

-- CreateTable
CREATE TABLE "ExecutionRecordHash" (
    "executionRecordId" TEXT NOT NULL PRIMARY KEY,
    "executionRequestHash" TEXT,
    "workflowRequestHash" TEXT,
    "workflowHash" TEXT,
    "lineageHash" TEXT,
    "provenanceHash" TEXT,
    "executionHash" TEXT,
    CONSTRAINT "ExecutionRecordHash_executionRecordId_fkey" FOREIGN KEY ("executionRecordId") REFERENCES "ExecutionRecord" ("storageId") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExecutionRecordLifecycleEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "executionRecordId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "event" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "occurredAt" DATETIME NOT NULL,
    "durationMs" INTEGER,
    CONSTRAINT "ExecutionRecordLifecycleEvent_executionRecordId_fkey" FOREIGN KEY ("executionRecordId") REFERENCES "ExecutionRecord" ("storageId") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExecutionObservation" (
    "executionRecordId" TEXT NOT NULL PRIMARY KEY,
    "observabilityVersion" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "executionId" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "requestId" TEXT,
    "status" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    "summaryWorkflowStatus" TEXT,
    "summaryReadinessFinal" TEXT,
    "summaryTotalDurationMs" INTEGER,
    "summaryTotalTokens" INTEGER,
    "summaryCostAmount" REAL,
    "summaryCostCurrency" TEXT,
    "summaryRateCardVersion" TEXT,
    CONSTRAINT "ExecutionObservation_executionRecordId_fkey" FOREIGN KEY ("executionRecordId") REFERENCES "ExecutionRecord" ("storageId") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExecutionObservedStage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "executionObservationId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "stageId" TEXT NOT NULL,
    "stageName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "durationMs" INTEGER,
    "requestId" TEXT,
    "executionId" TEXT NOT NULL,
    CONSTRAINT "ExecutionObservedStage_executionObservationId_fkey" FOREIGN KEY ("executionObservationId") REFERENCES "ExecutionObservation" ("executionRecordId") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExecutionStageMetric" (
    "executionObservedStageId" TEXT NOT NULL PRIMARY KEY,
    "stageId" TEXT NOT NULL,
    "durationMs" INTEGER,
    "promptBytes" INTEGER,
    "completionBytes" INTEGER,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "totalTokens" INTEGER,
    "providerLatencyMs" INTEGER,
    "validationDurationMs" INTEGER,
    "artifactGenerationDurationMs" INTEGER,
    CONSTRAINT "ExecutionStageMetric_executionObservedStageId_fkey" FOREIGN KEY ("executionObservedStageId") REFERENCES "ExecutionObservedStage" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExecutionObservationEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "executionObservationId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "stageName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "durationMs" INTEGER,
    "requestId" TEXT,
    "executionId" TEXT NOT NULL,
    "errorCode" TEXT,
    CONSTRAINT "ExecutionObservationEvent_executionObservationId_fkey" FOREIGN KEY ("executionObservationId") REFERENCES "ExecutionObservation" ("executionRecordId") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExecutionLineageOutput" (
    "executionRecordId" TEXT NOT NULL PRIMARY KEY,
    "productOwnerSpecificationHash" TEXT,
    "technicalSpecificationHash" TEXT,
    "qaSpecificationHash" TEXT,
    CONSTRAINT "ExecutionLineageOutput_executionRecordId_fkey" FOREIGN KEY ("executionRecordId") REFERENCES "ExecutionRecord" ("storageId") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExecutionLineageHandoff" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "executionRecordId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "fromStage" TEXT NOT NULL,
    "toStage" TEXT NOT NULL,
    "specification" TEXT NOT NULL,
    "calculatedHash" TEXT NOT NULL,
    "declaredHash" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL,
    CONSTRAINT "ExecutionLineageHandoff_executionRecordId_fkey" FOREIGN KEY ("executionRecordId") REFERENCES "ExecutionRecord" ("storageId") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExecutionProvenanceStage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "executionRecordId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "stage" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "agentExecutionId" TEXT NOT NULL,
    "agentVersion" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "readiness" TEXT,
    "assetBundleHash" TEXT NOT NULL,
    "knowledgeContextHash" TEXT NOT NULL,
    "promptHash" TEXT NOT NULL,
    "responseHash" TEXT NOT NULL,
    "validationHash" TEXT NOT NULL,
    "generationHash" TEXT,
    CONSTRAINT "ExecutionProvenanceStage_executionRecordId_fkey" FOREIGN KEY ("executionRecordId") REFERENCES "ExecutionRecord" ("storageId") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExecutionProvenanceArtifactHash" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "executionProvenanceStageId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "hash" TEXT NOT NULL,
    CONSTRAINT "ExecutionProvenanceArtifactHash_executionProvenanceStageId_fkey" FOREIGN KEY ("executionProvenanceStageId") REFERENCES "ExecutionProvenanceStage" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ExecutionRecord_workflowId_key" ON "ExecutionRecord"("workflowId");
CREATE UNIQUE INDEX "ExecutionRecord_executionId_key" ON "ExecutionRecord"("executionId");
CREATE INDEX "ExecutionRecord_status_createdAt_idx" ON "ExecutionRecord"("status", "createdAt");
CREATE INDEX "ExecutionRecord_readiness_createdAt_idx" ON "ExecutionRecord"("readiness", "createdAt");
CREATE INDEX "ExecutionRecord_requestId_idx" ON "ExecutionRecord"("requestId");
CREATE INDEX "ExecutionRecord_finishedAt_idx" ON "ExecutionRecord"("finishedAt");
CREATE INDEX "ExecutionRecordHash_executionHash_idx" ON "ExecutionRecordHash"("executionHash");
CREATE INDEX "ExecutionRecordLifecycleEvent_executionRecordId_occurredAt_idx" ON "ExecutionRecordLifecycleEvent"("executionRecordId", "occurredAt");
CREATE UNIQUE INDEX "ExecutionRecordLifecycleEvent_executionRecordId_sequence_key" ON "ExecutionRecordLifecycleEvent"("executionRecordId", "sequence");
CREATE INDEX "ExecutionObservation_executionId_idx" ON "ExecutionObservation"("executionId");
CREATE INDEX "ExecutionObservation_workflowId_idx" ON "ExecutionObservation"("workflowId");
CREATE INDEX "ExecutionObservation_status_updatedAt_idx" ON "ExecutionObservation"("status", "updatedAt");
CREATE INDEX "ExecutionObservedStage_status_idx" ON "ExecutionObservedStage"("status");
CREATE UNIQUE INDEX "ExecutionObservedStage_executionObservationId_stageId_key" ON "ExecutionObservedStage"("executionObservationId", "stageId");
CREATE UNIQUE INDEX "ExecutionObservedStage_executionObservationId_ordinal_key" ON "ExecutionObservedStage"("executionObservationId", "ordinal");
CREATE INDEX "ExecutionObservationEvent_executionObservationId_status_idx" ON "ExecutionObservationEvent"("executionObservationId", "status");
CREATE UNIQUE INDEX "ExecutionObservationEvent_executionObservationId_sequence_key" ON "ExecutionObservationEvent"("executionObservationId", "sequence");
CREATE UNIQUE INDEX "ExecutionLineageHandoff_executionRecordId_ordinal_key" ON "ExecutionLineageHandoff"("executionRecordId", "ordinal");
CREATE INDEX "ExecutionProvenanceStage_stage_outcome_idx" ON "ExecutionProvenanceStage"("stage", "outcome");
CREATE UNIQUE INDEX "ExecutionProvenanceStage_executionRecordId_ordinal_key" ON "ExecutionProvenanceStage"("executionRecordId", "ordinal");
CREATE INDEX "ExecutionProvenanceArtifactHash_hash_idx" ON "ExecutionProvenanceArtifactHash"("hash");
CREATE UNIQUE INDEX "ExecutionProvenanceArtifactHash_executionProvenanceStageId_ordinal_key" ON "ExecutionProvenanceArtifactHash"("executionProvenanceStageId", "ordinal");
