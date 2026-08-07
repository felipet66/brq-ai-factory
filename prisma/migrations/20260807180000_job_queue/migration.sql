-- CreateTable
CREATE TABLE "ExecutionJob" (
    "jobId" TEXT NOT NULL PRIMARY KEY,
    "executionRecordId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "queuedAt" DATETIME NOT NULL,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    CONSTRAINT "ExecutionJob_executionRecordId_fkey" FOREIGN KEY ("executionRecordId") REFERENCES "ExecutionRecord" ("storageId") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ExecutionJob_executionRecordId_key" ON "ExecutionJob"("executionRecordId");

-- CreateIndex
CREATE INDEX "ExecutionJob_status_queuedAt_idx" ON "ExecutionJob"("status", "queuedAt");

-- CreateIndex
CREATE INDEX "ExecutionJob_finishedAt_idx" ON "ExecutionJob"("finishedAt");
