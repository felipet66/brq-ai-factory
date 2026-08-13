-- CreateTable
CREATE TABLE "AiResponseCacheEntry" (
    "executionId" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "claimToken" TEXT,
    "responseHash" TEXT,
    "response" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,

    PRIMARY KEY ("executionId", "agent"),
    CONSTRAINT "AiResponseCacheEntry_state_check" CHECK (
      (
        "state" = 'PENDING' AND
        "claimToken" IS NOT NULL AND
        "responseHash" IS NULL AND
        "response" IS NULL AND
        "completedAt" IS NULL
      ) OR (
        "state" = 'COMPLETED' AND
        "claimToken" IS NULL AND
        "responseHash" IS NOT NULL AND
        "response" IS NOT NULL AND
        "completedAt" IS NOT NULL
      )
    )
);

-- CreateIndex
CREATE INDEX "AiResponseCacheEntry_executionId_state_idx" ON "AiResponseCacheEntry"("executionId", "state");

-- CreateIndex
CREATE INDEX "AiResponseCacheEntry_provider_requestHash_idx" ON "AiResponseCacheEntry"("provider", "requestHash");

-- CreateIndex
CREATE INDEX "AiResponseCacheEntry_executionId_createdAt_idx" ON "AiResponseCacheEntry"("executionId", "createdAt");

-- CreateIndex
CREATE INDEX "AiResponseCacheEntry_createdAt_idx" ON "AiResponseCacheEntry"("createdAt");

-- CreateIndex
CREATE INDEX "AiResponseCacheEntry_responseHash_idx" ON "AiResponseCacheEntry"("responseHash");
