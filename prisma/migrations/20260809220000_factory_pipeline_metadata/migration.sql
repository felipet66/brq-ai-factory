-- Factory pipeline persistence is additive. Existing execution rows intentionally keep a NULL
-- factory result because no downstream execution evidence existed before this migration.

ALTER TABLE "ExecutionObservation" ADD COLUMN "summaryFactoryStatus" TEXT;
ALTER TABLE "ExecutionObservation" ADD COLUMN "summaryFactoryResultHash" TEXT;

CREATE TABLE "ExecutionFactoryResult" (
    "executionRecordId" TEXT NOT NULL PRIMARY KEY,
    "factoryVersion" TEXT NOT NULL,
    "contractVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL,
    "finishedAt" DATETIME NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "readiness" TEXT,
    "terminalStage" TEXT NOT NULL,
    "factoryResultHash" TEXT NOT NULL,
    "lineageHash" TEXT NOT NULL,
    "provenanceHash" TEXT NOT NULL,
    "generationStatus" TEXT NOT NULL,
    "generatedFileCount" INTEGER,
    "generatedTotalBytes" INTEGER,
    "workspaceId" TEXT,
    "workspaceFileCount" INTEGER,
    "workspaceTotalBytes" INTEGER,
    "workspaceReleaseStatus" TEXT NOT NULL,
    "sandboxStatus" TEXT NOT NULL,
    "sandboxRunId" TEXT,
    "sandboxResourceOutcome" TEXT NOT NULL,
    "failureKind" TEXT,
    "failureCode" TEXT,
    "failureSourceCode" TEXT,
    "failureStageId" TEXT,
    CONSTRAINT "ExecutionFactoryResult_executionRecordId_fkey" FOREIGN KEY ("executionRecordId") REFERENCES "ExecutionRecord" ("storageId") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "ExecutionFactoryStageResult" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "executionFactoryResultId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "stageId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "durationMs" INTEGER,
    "outputHash" TEXT,
    "failureCode" TEXT,
    "resourceOutcome" TEXT,
    CONSTRAINT "ExecutionFactoryStageResult_executionFactoryResultId_fkey" FOREIGN KEY ("executionFactoryResultId") REFERENCES "ExecutionFactoryResult" ("executionRecordId") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "ExecutionFactoryLineage" (
    "executionFactoryResultId" TEXT NOT NULL PRIMARY KEY,
    "productOwnerSpecificationHash" TEXT,
    "technicalSpecificationHash" TEXT,
    "qaSpecificationHash" TEXT,
    "executionHash" TEXT NOT NULL,
    "workflowHash" TEXT,
    "generationHash" TEXT,
    "bundleHash" TEXT,
    "bundleContentHash" TEXT,
    "workspacePlanHash" TEXT,
    "workspaceHash" TEXT,
    "sandboxRequestHash" TEXT,
    "sandboxResultHash" TEXT,
    "factoryResultHash" TEXT NOT NULL,
    CONSTRAINT "ExecutionFactoryLineage_executionFactoryResultId_fkey" FOREIGN KEY ("executionFactoryResultId") REFERENCES "ExecutionFactoryResult" ("executionRecordId") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "ExecutionFactoryProvenance" (
    "executionFactoryResultId" TEXT NOT NULL PRIMARY KEY,
    "codeGeneratorAgentVersion" TEXT,
    "codeGeneratorContractVersion" TEXT,
    "codeGeneratorAssetBundleHash" TEXT,
    "workspaceVersion" TEXT,
    "workspaceContractVersion" TEXT,
    "workspacePolicyHash" TEXT,
    "workspaceConfigurationHash" TEXT,
    "sandboxRunnerVersion" TEXT,
    "sandboxContractVersion" TEXT,
    "sandboxSanitizerVersion" TEXT,
    "sandboxHelperAbiVersion" TEXT,
    "sandboxDependencySnapshotHash" TEXT,
    "sandboxPolicyId" TEXT,
    "sandboxPolicyVersion" TEXT,
    "sandboxPolicyHash" TEXT,
    "sandboxCommandPolicyHash" TEXT,
    "sandboxLimitsHash" TEXT,
    "sandboxAdapter" TEXT,
    "sandboxImageDigest" TEXT,
    "sandboxImageId" TEXT,
    "sandboxPlatform" TEXT,
    "sandboxRuntimeName" TEXT,
    "sandboxRuntimeVersion" TEXT,
    CONSTRAINT "ExecutionFactoryProvenance_executionFactoryResultId_fkey" FOREIGN KEY ("executionFactoryResultId") REFERENCES "ExecutionFactoryResult" ("executionRecordId") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "ExecutionFactoryToolchainVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "executionFactoryResultId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    CONSTRAINT "ExecutionFactoryToolchainVersion_executionFactoryResultId_fkey" FOREIGN KEY ("executionFactoryResultId") REFERENCES "ExecutionFactoryResult" ("executionRecordId") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "ExecutionFactoryResult_status_finishedAt_idx" ON "ExecutionFactoryResult"("status", "finishedAt");
CREATE INDEX "ExecutionFactoryResult_factoryResultHash_idx" ON "ExecutionFactoryResult"("factoryResultHash");
CREATE UNIQUE INDEX "ExecutionFactoryStageResult_executionFactoryResultId_ordinal_key" ON "ExecutionFactoryStageResult"("executionFactoryResultId", "ordinal");
CREATE UNIQUE INDEX "ExecutionFactoryStageResult_executionFactoryResultId_stageId_key" ON "ExecutionFactoryStageResult"("executionFactoryResultId", "stageId");
CREATE INDEX "ExecutionFactoryStageResult_stageId_status_idx" ON "ExecutionFactoryStageResult"("stageId", "status");
CREATE UNIQUE INDEX "ExecutionFactoryToolchainVersion_executionFactoryResultId_name_key" ON "ExecutionFactoryToolchainVersion"("executionFactoryResultId", "name");
CREATE INDEX "ExecutionFactoryToolchainVersion_name_version_idx" ON "ExecutionFactoryToolchainVersion"("name", "version");
