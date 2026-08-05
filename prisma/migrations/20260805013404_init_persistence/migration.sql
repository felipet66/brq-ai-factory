-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Execution" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    CONSTRAINT "Execution_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PromptVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agent" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "description" TEXT,
    "source" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AgentExecution" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "executionId" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "attempt" INTEGER NOT NULL,
    "input" JSONB NOT NULL,
    "output" JSONB,
    "agentVersion" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "model" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "durationMs" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    CONSTRAINT "AgentExecution_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "Execution" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AgentExecution_agent_promptVersion_fkey" FOREIGN KEY ("agent", "promptVersion") REFERENCES "PromptVersion" ("agent", "version") ON DELETE RESTRICT ON UPDATE RESTRICT
);

-- CreateTable
CREATE TABLE "Artifact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "executionId" TEXT NOT NULL,
    "agentExecutionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "provenance" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Artifact_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "Execution" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Artifact_agentExecutionId_fkey" FOREIGN KEY ("agentExecutionId") REFERENCES "AgentExecution" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Log" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "executionId" TEXT NOT NULL,
    "agentExecutionId" TEXT,
    "artifactId" TEXT,
    "level" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "message" TEXT,
    "context" JSONB NOT NULL,
    "requestId" TEXT,
    "traceId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Log_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "Execution" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Log_agentExecutionId_fkey" FOREIGN KEY ("agentExecutionId") REFERENCES "AgentExecution" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Log_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "Artifact" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Project_status_createdAt_idx" ON "Project"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Execution_projectId_createdAt_idx" ON "Execution"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "Execution_status_createdAt_idx" ON "Execution"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PromptVersion_agent_status_idx" ON "PromptVersion"("agent", "status");

-- CreateIndex
CREATE INDEX "PromptVersion_hash_idx" ON "PromptVersion"("hash");

-- CreateIndex
CREATE UNIQUE INDEX "PromptVersion_agent_version_key" ON "PromptVersion"("agent", "version");

-- CreateIndex
CREATE INDEX "AgentExecution_executionId_createdAt_idx" ON "AgentExecution"("executionId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentExecution_agent_status_createdAt_idx" ON "AgentExecution"("agent", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentExecution_executionId_agent_attempt_key" ON "AgentExecution"("executionId", "agent", "attempt");

-- CreateIndex
CREATE INDEX "Artifact_executionId_createdAt_idx" ON "Artifact"("executionId", "createdAt");

-- CreateIndex
CREATE INDEX "Artifact_agentExecutionId_createdAt_idx" ON "Artifact"("agentExecutionId", "createdAt");

-- CreateIndex
CREATE INDEX "Artifact_type_createdAt_idx" ON "Artifact"("type", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Artifact_executionId_filename_version_key" ON "Artifact"("executionId", "filename", "version");

-- CreateIndex
CREATE INDEX "Log_executionId_createdAt_idx" ON "Log"("executionId", "createdAt");

-- CreateIndex
CREATE INDEX "Log_agentExecutionId_createdAt_idx" ON "Log"("agentExecutionId", "createdAt");

-- CreateIndex
CREATE INDEX "Log_artifactId_createdAt_idx" ON "Log"("artifactId", "createdAt");

-- CreateIndex
CREATE INDEX "Log_event_createdAt_idx" ON "Log"("event", "createdAt");

-- CreateIndex
CREATE INDEX "Log_requestId_idx" ON "Log"("requestId");

-- CreateIndex
CREATE INDEX "Log_traceId_idx" ON "Log"("traceId");
