ALTER TABLE "ExecutionFactoryStageResult" ADD COLUMN "diagnosticCount" INTEGER;
ALTER TABLE "ExecutionFactoryStageResult" ADD COLUMN "diagnosticCodes" JSONB;
ALTER TABLE "ExecutionFactoryStageResult" ADD COLUMN "diagnosticTruncated" BOOLEAN;

ALTER TABLE "ExecutionFactoryResult" ADD COLUMN "failureDiagnosticCount" INTEGER;
ALTER TABLE "ExecutionFactoryResult" ADD COLUMN "failureDiagnosticCodes" JSONB;
ALTER TABLE "ExecutionFactoryResult" ADD COLUMN "failureDiagnosticTruncated" BOOLEAN;
