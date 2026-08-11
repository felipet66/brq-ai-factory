ALTER TABLE "ExecutionFactoryResult" ADD COLUMN "failureReasonCode" TEXT;

ALTER TABLE "ExecutionFactoryStageResult" ADD COLUMN "reasonCode" TEXT;

ALTER TABLE "ExecutionFactoryLineage" ADD COLUMN "executionProfileHash" TEXT;
ALTER TABLE "ExecutionFactoryLineage" ADD COLUMN "generationProjectionHash" TEXT;
ALTER TABLE "ExecutionFactoryLineage" ADD COLUMN "profileValidationHash" TEXT;

ALTER TABLE "ExecutionFactoryProvenance" ADD COLUMN "executionProfileId" TEXT;
ALTER TABLE "ExecutionFactoryProvenance" ADD COLUMN "executionProfileVersion" TEXT;
ALTER TABLE "ExecutionFactoryProvenance" ADD COLUMN "executionProfileContractVersion" TEXT;
ALTER TABLE "ExecutionFactoryProvenance" ADD COLUMN "executionProfileHash" TEXT;
ALTER TABLE "ExecutionFactoryProvenance" ADD COLUMN "generationProjectionHash" TEXT;
ALTER TABLE "ExecutionFactoryProvenance" ADD COLUMN "profileValidationHash" TEXT;
