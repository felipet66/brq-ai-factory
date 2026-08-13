-- CreateTable
CREATE TABLE "ExecutionRequestSnapshot" (
    "executionId" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "request" JSONB NOT NULL,
    "replaySourceExecutionId" TEXT,
    "replayCacheExecutionId" TEXT,
    "replayMode" TEXT,
    "createdAt" DATETIME NOT NULL,
    CONSTRAINT "ExecutionRequestSnapshot_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ExecutionRequestSnapshot_ownerId_createdAt_idx" ON "ExecutionRequestSnapshot"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "ExecutionRequestSnapshot_requestHash_idx" ON "ExecutionRequestSnapshot"("requestHash");

-- CreateIndex
CREATE INDEX "ExecutionRequestSnapshot_replaySourceExecutionId_idx" ON "ExecutionRequestSnapshot"("replaySourceExecutionId");

-- CreateIndex
CREATE INDEX "ExecutionRequestSnapshot_replayCacheExecutionId_idx" ON "ExecutionRequestSnapshot"("replayCacheExecutionId");
