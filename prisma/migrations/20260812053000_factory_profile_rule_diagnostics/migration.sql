ALTER TABLE "ExecutionFactoryResult" ADD COLUMN "failureProfileRuleId" TEXT;

ALTER TABLE "ExecutionFactoryStageResult" ADD COLUMN "profileRuleId" TEXT;
