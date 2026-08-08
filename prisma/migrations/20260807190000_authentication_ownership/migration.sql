-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "role" TEXT NOT NULL DEFAULT 'USER',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "expiresAt" DATETIME NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" DATETIME,
    "refreshTokenExpiresAt" DATETIME,
    "scope" TEXT,
    "password" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Verification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- Existing execution history predates authentication. The migration-only principal is disabled
-- by convention (no Account and therefore no credential) and owns only backfilled records.
INSERT INTO "User" (
    "id",
    "email",
    "name",
    "emailVerified",
    "image",
    "role",
    "createdAt",
    "updatedAt"
) VALUES (
    'user-legacy-execution-owner',
    'legacy-execution-owner@invalid.local',
    'Legacy execution owner',
    false,
    NULL,
    'USER',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
);

-- RedefineTable
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ExecutionRecord" (
    "storageId" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
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
    "failureSourceCode" TEXT,
    CONSTRAINT "ExecutionRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_ExecutionRecord" (
    "storageId",
    "userId",
    "workflowId",
    "executionId",
    "requestId",
    "traceId",
    "projectName",
    "status",
    "workflowStatus",
    "readiness",
    "createdAt",
    "startedAt",
    "finishedAt",
    "durationMs",
    "engineVersion",
    "contractVersion",
    "attempt",
    "revision",
    "failureKind",
    "failureCode",
    "failureSourceCode"
)
SELECT
    "storageId",
    'user-legacy-execution-owner',
    "workflowId",
    "executionId",
    "requestId",
    "traceId",
    "projectName",
    "status",
    "workflowStatus",
    "readiness",
    "createdAt",
    "startedAt",
    "finishedAt",
    "durationMs",
    "engineVersion",
    "contractVersion",
    "attempt",
    "revision",
    "failureKind",
    "failureCode",
    "failureSourceCode"
FROM "ExecutionRecord";
DROP TABLE "ExecutionRecord";
ALTER TABLE "new_ExecutionRecord" RENAME TO "ExecutionRecord";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");
CREATE INDEX "Session_userId_idx" ON "Session"("userId");
CREATE INDEX "Account_userId_idx" ON "Account"("userId");
CREATE UNIQUE INDEX "Account_providerId_accountId_key" ON "Account"("providerId", "accountId");
CREATE INDEX "Verification_identifier_idx" ON "Verification"("identifier");
CREATE UNIQUE INDEX "ExecutionRecord_workflowId_key" ON "ExecutionRecord"("workflowId");
CREATE UNIQUE INDEX "ExecutionRecord_executionId_key" ON "ExecutionRecord"("executionId");
CREATE INDEX "ExecutionRecord_userId_createdAt_idx" ON "ExecutionRecord"("userId", "createdAt");
CREATE INDEX "ExecutionRecord_userId_status_createdAt_idx" ON "ExecutionRecord"("userId", "status", "createdAt");
CREATE INDEX "ExecutionRecord_userId_readiness_createdAt_idx" ON "ExecutionRecord"("userId", "readiness", "createdAt");
CREATE INDEX "ExecutionRecord_status_createdAt_idx" ON "ExecutionRecord"("status", "createdAt");
CREATE INDEX "ExecutionRecord_readiness_createdAt_idx" ON "ExecutionRecord"("readiness", "createdAt");
CREATE INDEX "ExecutionRecord_requestId_idx" ON "ExecutionRecord"("requestId");
CREATE INDEX "ExecutionRecord_finishedAt_idx" ON "ExecutionRecord"("finishedAt");
