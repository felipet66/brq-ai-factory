const collectionLimits = Object.freeze({
  apis: 40,
  assumptions: 30,
  components: 30,
  contracts: 40,
  decisions: 30,
  definitionOfDone: 40,
  entities: 40,
  events: 40,
  externalDependencies: 30,
  flows: 30,
  implementationPhases: 20,
  implementationPlan: 80,
  internalDependencies: 30,
  modules: 80,
  openQuestions: 30,
  outOfScope: 30,
  relations: 80,
  risks: 30,
  technicalBacklog: 80,
  traceability: 30,
});

const nestedLimits = Object.freeze({
  alternatives: 10,
  architectureConstraints: 30,
  architecturePatterns: 20,
  componentReferences: 30,
  entityFields: 50,
  flowSteps: 20,
  moduleReferences: 80,
  references: 100,
  tradeOffs: 10,
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
  actionCharacters: 2_000,
  apiPathCharacters: 512,
  architectureCharacters: 4_000,
  descriptionCharacters: 2_000,
  estimatedStoryPoints: 100,
  fieldTypeCharacters: 200,
  itemCharacters: 1_000,
  nameCharacters: 200,
  objectiveCharacters: 2_000,
  pathCharacters: 512,
  summaryCharacters: 2_000,
  titleCharacters: 160,
});

export const DEVELOPER_CONTRACT_LIMITS = Object.freeze({
  collections: collectionLimits,
  nested: nestedLimits,
  request: requestLimits,
  specification: specificationLimits,
});
