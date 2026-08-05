const collectionLimits = Object.freeze({
  acceptanceCriteria: 30,
  assumptions: 20,
  backlogItems: 30,
  businessRules: 30,
  definitionOfReady: 20,
  dependencies: 20,
  openQuestions: 20,
  outOfScope: 20,
  risks: 20,
  scenarios: 20,
});

const requestLimits = Object.freeze({
  additionalContextCharacters: 16_000,
  businessGoalCharacters: 2_000,
  constraintCharacters: 1_000,
  constraints: 30,
  demandDescriptionCharacters: 16_000,
  demandTitleCharacters: 200,
  knowledgeBytes: 512 * 1024,
  knowledgeDocuments: 64,
  maxOutputTokens: 131_072,
  modelCharacters: 200,
  promptBytes: 1024 * 1024,
  targetUserCharacters: 200,
  targetUsers: 20,
  timeoutMs: 600_000,
});

const specificationLimits = Object.freeze({
  backlogDescriptionCharacters: 2_000,
  contextCharacters: 4_000,
  itemDescriptionCharacters: 1_000,
  itemTitleCharacters: 200,
  objectiveCharacters: 2_000,
  scenarioSteps: 5,
  summaryCharacters: 2_000,
  titleCharacters: 160,
  userStoryPartCharacters: 500,
});

export const PRODUCT_OWNER_CONTRACT_LIMITS = Object.freeze({
  collections: collectionLimits,
  request: requestLimits,
  specification: specificationLimits,
});
