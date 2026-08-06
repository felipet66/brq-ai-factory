const collectionLimits = Object.freeze({
  approvalCriteria: 40,
  assumptions: 30,
  automationRecommendations: 60,
  blockingItems: 30,
  edgeCases: 60,
  functionalCoverage: 200,
  negativeScenarios: 60,
  openQuestions: 30,
  outOfScope: 30,
  positiveScenarios: 60,
  priorityTests: 180,
  risks: 40,
  technicalCoverage: 200,
  traceability: 200,
});

const nestedLimits = Object.freeze({
  listItems: 50,
  references: 200,
  scenarioSteps: 30,
  testTypes: 12,
});

const requestLimits = Object.freeze({
  knowledgeBytes: 512 * 1024,
  knowledgeDocuments: 64,
  maxOutputTokens: 131_072,
  modelCharacters: 200,
  promptBytes: 1024 * 1024,
  timeoutMs: 600_000,
});

const specificationLimits = Object.freeze({
  descriptionCharacters: 2_000,
  itemCharacters: 1_000,
  objectiveCharacters: 2_000,
  summaryCharacters: 2_000,
  titleCharacters: 160,
});

export const QA_CONTRACT_LIMITS = Object.freeze({
  collections: collectionLimits,
  nested: nestedLimits,
  request: requestLimits,
  specification: specificationLimits,
});
