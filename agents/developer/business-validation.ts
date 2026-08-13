import { READINESS_DECISION_VERSION } from '@brq/shared/schemas/readiness-decision.schema';
import type { DeliveryIntent } from '@brq/shared/types/delivery-intent';
import type { ReadinessDecision } from '@brq/shared/types/readiness-decision';

import { deepFreeze } from './immutability';

export const DEVELOPER_BUSINESS_VALIDATION_ISSUE_CODES = {
  INVALID_SPECIFICATION_STRUCTURE: 'DEVELOPER_INVALID_SPECIFICATION_STRUCTURE',
  DUPLICATE_ID: 'DEVELOPER_DUPLICATE_ID',
  DUPLICATE_PATH: 'DEVELOPER_DUPLICATE_PATH',
  DUPLICATE_REFERENCE: 'DEVELOPER_DUPLICATE_REFERENCE',
  UNKNOWN_REFERENCE: 'DEVELOPER_UNKNOWN_REFERENCE',
  SELF_REFERENCE: 'DEVELOPER_SELF_REFERENCE',
  CYCLIC_DEPENDENCY: 'DEVELOPER_CYCLIC_DEPENDENCY',
  INVALID_ORDER: 'DEVELOPER_INVALID_ORDER',
  INCONSISTENT_OWNERSHIP: 'DEVELOPER_INCONSISTENT_OWNERSHIP',
  DATA_MODEL_MISMATCH: 'DEVELOPER_DATA_MODEL_MISMATCH',
  READINESS_MISMATCH: 'DEVELOPER_READINESS_MISMATCH',
  INCOMPLETE_SPECIFICATION: 'DEVELOPER_INCOMPLETE_SPECIFICATION',
  MISSING_ACCEPTANCE_CRITERION_COVERAGE: 'DEVELOPER_MISSING_ACCEPTANCE_CRITERION_COVERAGE',
  INCOMPLETE_TRACEABILITY: 'DEVELOPER_INCOMPLETE_TRACEABILITY',
  CHANGE_TYPE_NOT_ALLOWED: 'DEVELOPER_CHANGE_TYPE_NOT_ALLOWED',
} as const;

export const DEVELOPER_READINESS_VALUES = [
  'READY',
  'PARTIALLY_READY',
  'REQUIRES_CLARIFICATION',
] as const;

export const DEVELOPER_BUSINESS_VALIDATION_MAX_ISSUES = 100;

export type DeveloperReadiness = (typeof DEVELOPER_READINESS_VALUES)[number];
export type DeveloperBusinessValidationIssueCode =
  (typeof DEVELOPER_BUSINESS_VALIDATION_ISSUE_CODES)[keyof typeof DEVELOPER_BUSINESS_VALIDATION_ISSUE_CODES];

export interface DeveloperBusinessValidationIssue {
  readonly code: DeveloperBusinessValidationIssueCode;
  readonly path: readonly (string | number)[];
  readonly message: string;
}

export interface DeveloperBusinessValidationResult {
  readonly valid: boolean;
  readonly expectedReadiness: DeveloperReadiness | null;
  readonly issues: readonly DeveloperBusinessValidationIssue[];
  readonly issuesTruncated: boolean;
}

export interface DeveloperSpecificationStructureIssue {
  readonly path: readonly PropertyKey[];
}

interface IdentifiedValue {
  readonly id: string;
}

export interface DeveloperProductOwnerSpecificationInput {
  readonly readiness: DeveloperReadiness;
  readonly acceptanceCriteria: readonly IdentifiedValue[];
  readonly businessRules: readonly IdentifiedValue[];
  readonly backlogItems: readonly IdentifiedValue[];
}

interface ReferenceCollections {
  readonly componentIds?: readonly string[];
  readonly moduleIds?: readonly string[];
  readonly acceptanceCriteriaIds?: readonly string[];
}

interface Question extends IdentifiedValue {
  readonly impact: 'BLOCKING' | 'NON_BLOCKING';
}

interface Assumption extends IdentifiedValue {
  readonly requiresValidation: boolean;
}

export interface DeveloperBusinessValidationInput {
  readonly readiness: DeveloperReadiness;
  readonly architecture: object;
  readonly components: readonly (IdentifiedValue & {
    readonly changeType?: 'CREATE' | 'MODIFY' | 'DELETE';
    readonly moduleIds: readonly string[];
    readonly dependsOnComponentIds: readonly string[];
  })[];
  readonly modules: readonly (IdentifiedValue & {
    readonly changeType?: 'CREATE' | 'MODIFY' | 'DELETE';
    readonly path: string;
    readonly componentId: string;
    readonly dependsOnModuleIds: readonly string[];
  })[];
  readonly flows: readonly (IdentifiedValue & {
    readonly steps: readonly {
      readonly order: number;
      readonly componentId: string;
      readonly moduleId: string | null;
    }[];
    readonly acceptanceCriteriaIds: readonly string[];
  })[];
  readonly contracts: readonly (IdentifiedValue & {
    readonly ownerComponentId: string;
    readonly consumerComponentIds: readonly string[];
  })[];
  readonly apis: readonly (IdentifiedValue & {
    readonly componentId: string;
    readonly requestContractId: string | null;
    readonly responseContractId: string | null;
    readonly acceptanceCriteriaIds: readonly string[];
  })[];
  readonly events: readonly (IdentifiedValue & {
    readonly producerComponentId: string;
    readonly consumerComponentIds: readonly string[];
    readonly payloadContractId: string | null;
    readonly acceptanceCriteriaIds: readonly string[];
  })[];
  readonly dataModel: {
    readonly changesRequired: boolean;
    readonly migrationRequired: boolean;
    readonly entities: readonly (IdentifiedValue & { readonly moduleId: string | null })[];
    readonly relations: readonly (IdentifiedValue & {
      readonly sourceEntityId: string;
      readonly targetEntityId: string;
    })[];
  };
  readonly internalDependencies: readonly (IdentifiedValue & {
    readonly componentId: string;
  })[];
  readonly externalDependencies: readonly (IdentifiedValue & {
    readonly componentId: string;
  })[];
  readonly risks: readonly (IdentifiedValue & ReferenceCollections)[];
  readonly implementationPhases: readonly (IdentifiedValue & {
    readonly order: number;
    readonly dependsOnPhaseIds: readonly string[];
  })[];
  readonly implementationPlan: readonly (IdentifiedValue &
    ReferenceCollections & {
      readonly order: number;
      readonly phaseId: string;
      readonly dependsOnPlanItemIds: readonly string[];
    })[];
  readonly technicalBacklog: readonly (IdentifiedValue & {
    readonly implementationPlanIds: readonly string[];
    readonly dependsOnBacklogItemIds: readonly string[];
    readonly acceptanceCriteriaIds: readonly string[];
  })[];
  readonly definitionOfDone: readonly (IdentifiedValue & {
    readonly acceptanceCriteriaIds: readonly string[];
  })[];
  readonly decisions: readonly (IdentifiedValue & ReferenceCollections)[];
  readonly traceability: readonly (IdentifiedValue & {
    readonly sourceIds: readonly string[];
    readonly componentIds: readonly string[];
    readonly moduleIds: readonly string[];
    readonly flowIds: readonly string[];
    readonly contractIds: readonly string[];
    readonly apiIds: readonly string[];
    readonly eventIds: readonly string[];
    readonly implementationPlanIds: readonly string[];
    readonly technicalBacklogIds: readonly string[];
    readonly definitionOfDoneIds: readonly string[];
  })[];
  readonly assumptions: readonly Assumption[];
  readonly openQuestions: readonly Question[];
  readonly outOfScope: readonly IdentifiedValue[];
}

type IssueCollector = DeveloperBusinessValidationIssue[];

function sanitizedPath(path: readonly PropertyKey[]): readonly (string | number)[] {
  const result: (string | number)[] = [];
  for (const segment of path.slice(0, 32)) {
    if (typeof segment === 'string') result.push(segment);
    if (typeof segment === 'number' && Number.isInteger(segment) && segment >= 0) {
      result.push(segment);
    }
  }
  return result;
}

export function createDeveloperBusinessStructureRejection(
  structureIssues: readonly DeveloperSpecificationStructureIssue[],
): DeveloperBusinessValidationResult {
  const sourceIssues =
    structureIssues.length === 0
      ? [{ path: [] }]
      : structureIssues.slice(0, DEVELOPER_BUSINESS_VALIDATION_MAX_ISSUES);
  const issues = sourceIssues.map(({ path }) => ({
    code: DEVELOPER_BUSINESS_VALIDATION_ISSUE_CODES.INVALID_SPECIFICATION_STRUCTURE,
    path: sanitizedPath(path),
    message: 'A especificação não atende à estrutura técnica esperada.',
  }));

  return deepFreeze({
    valid: false,
    expectedReadiness: null,
    issues,
    issuesTruncated: structureIssues.length > sourceIssues.length,
  });
}

function addIssue(
  issues: IssueCollector,
  code: DeveloperBusinessValidationIssueCode,
  path: readonly (string | number)[],
  message: string,
): void {
  issues.push({ code, path, message });
}

function validateUniqueIds(
  issues: IssueCollector,
  collectionName: string,
  values: readonly IdentifiedValue[],
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value.id)) {
      addIssue(
        issues,
        DEVELOPER_BUSINESS_VALIDATION_ISSUE_CODES.DUPLICATE_ID,
        [collectionName, index, 'id'],
        'O ID deve ser único dentro da coleção.',
      );
    }
    seen.add(value.id);
  });
}

function validateReferences(
  issues: IssueCollector,
  references: readonly string[],
  knownIds: ReadonlySet<string>,
  path: readonly (string | number)[],
): void {
  const seen = new Set<string>();
  references.forEach((reference, index) => {
    if (seen.has(reference)) {
      addIssue(
        issues,
        DEVELOPER_BUSINESS_VALIDATION_ISSUE_CODES.DUPLICATE_REFERENCE,
        [...path, index],
        'Uma referência não pode ser repetida na mesma lista.',
      );
    }
    if (!knownIds.has(reference)) {
      addIssue(
        issues,
        DEVELOPER_BUSINESS_VALIDATION_ISSUE_CODES.UNKNOWN_REFERENCE,
        [...path, index],
        'A referência deve apontar para um ID existente.',
      );
    }
    seen.add(reference);
  });
}

function validateNullableReference(
  issues: IssueCollector,
  reference: string | null,
  knownIds: ReadonlySet<string>,
  path: readonly (string | number)[],
): void {
  if (reference !== null && !knownIds.has(reference)) {
    addIssue(
      issues,
      DEVELOPER_BUSINESS_VALIDATION_ISSUE_CODES.UNKNOWN_REFERENCE,
      path,
      'A referência deve apontar para um ID existente.',
    );
  }
}

function validateScalarReference(
  issues: IssueCollector,
  reference: string,
  knownIds: ReadonlySet<string>,
  path: readonly (string | number)[],
): void {
  if (!knownIds.has(reference)) {
    addIssue(
      issues,
      DEVELOPER_BUSINESS_VALIDATION_ISSUE_CODES.UNKNOWN_REFERENCE,
      path,
      'A referência deve apontar para um ID existente.',
    );
  }
}

function validateContiguousOrder(
  issues: IssueCollector,
  values: readonly { readonly order: number }[],
  path: readonly (string | number)[],
): void {
  values.forEach(({ order }, index) => {
    if (order !== index + 1) {
      addIssue(
        issues,
        DEVELOPER_BUSINESS_VALIDATION_ISSUE_CODES.INVALID_ORDER,
        path,
        'A ordem deve ser única e contígua, iniciando em 1.',
      );
    }
  });
}

function validateDependencyGraph(
  issues: IssueCollector,
  collectionName: string,
  fieldName: string,
  values: readonly IdentifiedValue[],
  references: (value: IdentifiedValue) => readonly string[],
): void {
  const knownIds = new Set(values.map(({ id }) => id));
  const graph = new Map<string, readonly string[]>();

  values.forEach((value, index) => {
    const dependencies = references(value);
    dependencies.forEach((dependency, dependencyIndex) => {
      if (dependency === value.id) {
        addIssue(
          issues,
          DEVELOPER_BUSINESS_VALIDATION_ISSUE_CODES.SELF_REFERENCE,
          [collectionName, index, fieldName, dependencyIndex],
          'Uma dependência não pode apontar para o próprio item.',
        );
      }
    });
    graph.set(
      value.id,
      dependencies.filter((dependency) => dependency !== value.id && knownIds.has(dependency)),
    );
  });

  const states = new Map<string, 'VISITING' | 'VISITED'>();
  const reported = new Set<string>();
  const visit = (id: string): void => {
    states.set(id, 'VISITING');
    for (const dependency of graph.get(id) ?? []) {
      const state = states.get(dependency);
      if (state === 'VISITING') {
        if (!reported.has(id)) {
          const index = values.findIndex((value) => value.id === id);
          addIssue(
            issues,
            DEVELOPER_BUSINESS_VALIDATION_ISSUE_CODES.CYCLIC_DEPENDENCY,
            [collectionName, index, fieldName],
            'O grafo de dependências não pode conter ciclos.',
          );
          reported.add(id);
        }
      } else if (state === undefined) {
        visit(dependency);
      }
    }
    states.set(id, 'VISITED');
  };

  for (const { id } of values) {
    if (states.get(id) === undefined) visit(id);
  }
}

export function explainDeveloperReadiness(
  productOwnerReadiness: DeveloperReadiness,
  openQuestions: readonly Question[],
  assumptions: readonly Assumption[],
): ReadinessDecision {
  if (
    productOwnerReadiness === 'REQUIRES_CLARIFICATION' ||
    openQuestions.some((question) => question.impact === 'BLOCKING')
  ) {
    const decisiveFactors: ReadinessDecision['decisiveFactors'][number][] = [];
    if (productOwnerReadiness === 'REQUIRES_CLARIFICATION') {
      decisiveFactors.push({
        sourceStage: 'PRODUCT_OWNER',
        code: 'SOURCE_REQUIRES_CLARIFICATION',
      });
    }
    if (openQuestions.some((question) => question.impact === 'BLOCKING')) {
      decisiveFactors.push({ sourceStage: 'DEVELOPER', code: 'BLOCKING_QUESTION_PRESENT' });
    }
    return deepFreeze({
      version: READINESS_DECISION_VERSION,
      readiness: 'REQUIRES_CLARIFICATION',
      decisiveFactors,
    });
  }

  const decisiveFactors: ReadinessDecision['decisiveFactors'][number][] = [];
  if (productOwnerReadiness === 'PARTIALLY_READY') {
    decisiveFactors.push({
      sourceStage: 'PRODUCT_OWNER',
      code: 'SOURCE_PARTIALLY_READY',
    });
  }
  if (openQuestions.length > 0) {
    decisiveFactors.push({ sourceStage: 'DEVELOPER', code: 'NON_BLOCKING_QUESTION_PRESENT' });
  }
  if (assumptions.some((assumption) => assumption.requiresValidation)) {
    decisiveFactors.push({
      sourceStage: 'DEVELOPER',
      code: 'VALIDATION_REQUIRED_ASSUMPTION_PRESENT',
    });
  }

  return deepFreeze(
    decisiveFactors.length > 0
      ? {
          version: READINESS_DECISION_VERSION,
          readiness: 'PARTIALLY_READY',
          decisiveFactors,
        }
      : {
          version: READINESS_DECISION_VERSION,
          readiness: 'READY',
          decisiveFactors: [
            { sourceStage: 'PRODUCT_OWNER', code: 'SOURCE_READY' },
            { sourceStage: 'DEVELOPER', code: 'NO_LOCAL_READINESS_CONCERNS' },
          ],
        },
  );
}

export function deriveDeveloperReadiness(
  productOwnerReadiness: DeveloperReadiness,
  openQuestions: readonly Question[],
  assumptions: readonly Assumption[],
): DeveloperReadiness {
  return explainDeveloperReadiness(productOwnerReadiness, openQuestions, assumptions).readiness;
}

function validateCompleteness(
  specification: DeveloperBusinessValidationInput,
  expectedReadiness: DeveloperReadiness,
  issues: IssueCollector,
): void {
  if (expectedReadiness === 'REQUIRES_CLARIFICATION') return;
  const requirements: readonly [boolean, readonly (string | number)[]][] = [
    [specification.components.length > 0, ['components']],
    [specification.modules.length > 0, ['modules']],
    [specification.implementationPhases.length > 0, ['implementationPhases']],
    [specification.implementationPlan.length > 0, ['implementationPlan']],
    [specification.technicalBacklog.length > 0, ['technicalBacklog']],
    [specification.definitionOfDone.length > 0, ['definitionOfDone']],
  ];
  for (const [satisfied, path] of requirements) {
    if (!satisfied) {
      addIssue(
        issues,
        DEVELOPER_BUSINESS_VALIDATION_ISSUE_CODES.INCOMPLETE_SPECIFICATION,
        path,
        'READY e PARTIALLY_READY exigem os elementos técnicos mínimos.',
      );
    }
  }
}

function validateTraceability(
  specification: DeveloperBusinessValidationInput,
  productOwnerSpecification: DeveloperProductOwnerSpecificationInput,
  known: {
    readonly sources: ReadonlySet<string>;
    readonly acceptanceCriteria: ReadonlySet<string>;
    readonly components: ReadonlySet<string>;
    readonly modules: ReadonlySet<string>;
    readonly flows: ReadonlySet<string>;
    readonly contracts: ReadonlySet<string>;
    readonly apis: ReadonlySet<string>;
    readonly events: ReadonlySet<string>;
    readonly plans: ReadonlySet<string>;
    readonly backlog: ReadonlySet<string>;
    readonly definitionOfDone: ReadonlySet<string>;
  },
  issues: IssueCollector,
): void {
  const coveredAcceptanceCriteria = new Map<string, number>();

  specification.traceability.forEach((item, index) => {
    validateReferences(issues, item.sourceIds, known.sources, ['traceability', index, 'sourceIds']);
    validateReferences(issues, item.componentIds, known.components, [
      'traceability',
      index,
      'componentIds',
    ]);
    validateReferences(issues, item.moduleIds, known.modules, ['traceability', index, 'moduleIds']);
    validateReferences(issues, item.flowIds, known.flows, ['traceability', index, 'flowIds']);
    validateReferences(issues, item.contractIds, known.contracts, [
      'traceability',
      index,
      'contractIds',
    ]);
    validateReferences(issues, item.apiIds, known.apis, ['traceability', index, 'apiIds']);
    validateReferences(issues, item.eventIds, known.events, ['traceability', index, 'eventIds']);
    validateReferences(issues, item.implementationPlanIds, known.plans, [
      'traceability',
      index,
      'implementationPlanIds',
    ]);
    validateReferences(issues, item.technicalBacklogIds, known.backlog, [
      'traceability',
      index,
      'technicalBacklogIds',
    ]);
    validateReferences(issues, item.definitionOfDoneIds, known.definitionOfDone, [
      'traceability',
      index,
      'definitionOfDoneIds',
    ]);

    for (const sourceId of item.sourceIds) {
      if (known.acceptanceCriteria.has(sourceId)) {
        coveredAcceptanceCriteria.set(sourceId, (coveredAcceptanceCriteria.get(sourceId) ?? 0) + 1);
      }
    }

    const technicalDestinationCount =
      item.componentIds.length +
      item.moduleIds.length +
      item.flowIds.length +
      item.contractIds.length +
      item.apiIds.length +
      item.eventIds.length +
      item.implementationPlanIds.length +
      item.technicalBacklogIds.length +
      item.definitionOfDoneIds.length;
    if (technicalDestinationCount === 0) {
      addIssue(
        issues,
        DEVELOPER_BUSINESS_VALIDATION_ISSUE_CODES.INCOMPLETE_TRACEABILITY,
        ['traceability', index],
        'Cada item de rastreabilidade deve apontar para ao menos um destino técnico.',
      );
    }
  });

  productOwnerSpecification.acceptanceCriteria.forEach((criterion) => {
    const coverage = coveredAcceptanceCriteria.get(criterion.id) ?? 0;
    if (coverage === 0) {
      addIssue(
        issues,
        DEVELOPER_BUSINESS_VALIDATION_ISSUE_CODES.MISSING_ACCEPTANCE_CRITERION_COVERAGE,
        ['traceability'],
        'Cada critério de aceite deve possuir cobertura técnica explícita.',
      );
    }
  });
}

export function validateDeveloperBusinessRules(
  specification: DeveloperBusinessValidationInput,
  productOwnerSpecification: DeveloperProductOwnerSpecificationInput,
  deliveryIntent: DeliveryIntent,
): DeveloperBusinessValidationResult {
  const issues: DeveloperBusinessValidationIssue[] = [];
  const collections: readonly [string, readonly IdentifiedValue[]][] = [
    ['components', specification.components],
    ['modules', specification.modules],
    ['flows', specification.flows],
    ['contracts', specification.contracts],
    ['apis', specification.apis],
    ['events', specification.events],
    ['dataModel.entities', specification.dataModel.entities],
    ['dataModel.relations', specification.dataModel.relations],
    ['internalDependencies', specification.internalDependencies],
    ['externalDependencies', specification.externalDependencies],
    ['risks', specification.risks],
    ['implementationPhases', specification.implementationPhases],
    ['implementationPlan', specification.implementationPlan],
    ['technicalBacklog', specification.technicalBacklog],
    ['definitionOfDone', specification.definitionOfDone],
    ['decisions', specification.decisions],
    ['traceability', specification.traceability],
    ['assumptions', specification.assumptions],
    ['openQuestions', specification.openQuestions],
    ['outOfScope', specification.outOfScope],
  ];
  for (const [name, values] of collections) validateUniqueIds(issues, name, values);

  const ids = <T extends IdentifiedValue>(values: readonly T[]) =>
    new Set(values.map(({ id }) => id));
  const componentIds = ids(specification.components);
  const moduleIds = ids(specification.modules);
  const flowIds = ids(specification.flows);
  const contractIds = ids(specification.contracts);
  const apiIds = ids(specification.apis);
  const eventIds = ids(specification.events);
  const entityIds = ids(specification.dataModel.entities);
  const phaseIds = ids(specification.implementationPhases);
  const planIds = ids(specification.implementationPlan);
  const backlogIds = ids(specification.technicalBacklog);
  const definitionOfDoneIds = ids(specification.definitionOfDone);
  const acceptanceCriterionIds = ids(productOwnerSpecification.acceptanceCriteria);
  const functionalSourceIds = new Set([
    ...productOwnerSpecification.acceptanceCriteria.map(({ id }) => id),
    ...productOwnerSpecification.businessRules.map(({ id }) => id),
    ...productOwnerSpecification.backlogItems.map(({ id }) => id),
  ]);

  if (deliveryIntent.mode === 'GREENFIELD') {
    specification.components.forEach((component, index) => {
      if (component.changeType !== 'CREATE') {
        addIssue(
          issues,
          DEVELOPER_BUSINESS_VALIDATION_ISSUE_CODES.CHANGE_TYPE_NOT_ALLOWED,
          ['components', index, 'changeType'],
          'Uma entrega GREENFIELD exige changeType CREATE em todos os componentes.',
        );
      }
    });
    specification.modules.forEach((module, index) => {
      if (module.changeType !== 'CREATE') {
        addIssue(
          issues,
          DEVELOPER_BUSINESS_VALIDATION_ISSUE_CODES.CHANGE_TYPE_NOT_ALLOWED,
          ['modules', index, 'changeType'],
          'Uma entrega GREENFIELD exige changeType CREATE em todos os módulos.',
        );
      }
    });
  }

  specification.components.forEach((component, index) => {
    validateReferences(issues, component.moduleIds, moduleIds, ['components', index, 'moduleIds']);
    validateReferences(issues, component.dependsOnComponentIds, componentIds, [
      'components',
      index,
      'dependsOnComponentIds',
    ]);
  });
  specification.modules.forEach((module, index) => {
    validateScalarReference(issues, module.componentId, componentIds, [
      'modules',
      index,
      'componentId',
    ]);
    validateReferences(issues, module.dependsOnModuleIds, moduleIds, [
      'modules',
      index,
      'dependsOnModuleIds',
    ]);
    const owner = specification.components.find(({ id }) => id === module.componentId);
    if (owner !== undefined && !owner.moduleIds.includes(module.id)) {
      addIssue(
        issues,
        DEVELOPER_BUSINESS_VALIDATION_ISSUE_CODES.INCONSISTENT_OWNERSHIP,
        ['modules', index, 'componentId'],
        'O módulo deve constar na lista de módulos do componente proprietário.',
      );
    }
  });
  specification.components.forEach((component, componentIndex) => {
    component.moduleIds.forEach((moduleId, referenceIndex) => {
      const referencedModule = specification.modules.find(({ id }) => id === moduleId);
      if (referencedModule !== undefined && referencedModule.componentId !== component.id) {
        addIssue(
          issues,
          DEVELOPER_BUSINESS_VALIDATION_ISSUE_CODES.INCONSISTENT_OWNERSHIP,
          ['components', componentIndex, 'moduleIds', referenceIndex],
          'O módulo deve apontar de volta para o componente proprietário.',
        );
      }
    });
  });

  const portablePaths = new Set<string>();
  specification.modules.forEach((module, index) => {
    const portablePath = module.path.normalize('NFC').toLowerCase();
    if (portablePaths.has(portablePath)) {
      addIssue(
        issues,
        DEVELOPER_BUSINESS_VALIDATION_ISSUE_CODES.DUPLICATE_PATH,
        ['modules', index, 'path'],
        'O path do módulo deve ser único de forma portável.',
      );
    }
    portablePaths.add(portablePath);
  });

  specification.flows.forEach((flow, index) => {
    validateContiguousOrder(issues, flow.steps, ['flows', index, 'steps']);
    flow.steps.forEach((step, stepIndex) => {
      validateScalarReference(issues, step.componentId, componentIds, [
        'flows',
        index,
        'steps',
        stepIndex,
        'componentId',
      ]);
      validateNullableReference(issues, step.moduleId, moduleIds, [
        'flows',
        index,
        'steps',
        stepIndex,
        'moduleId',
      ]);
      const referencedModule = specification.modules.find(({ id }) => id === step.moduleId);
      if (referencedModule !== undefined && referencedModule.componentId !== step.componentId) {
        addIssue(
          issues,
          DEVELOPER_BUSINESS_VALIDATION_ISSUE_CODES.INCONSISTENT_OWNERSHIP,
          ['flows', index, 'steps', stepIndex, 'moduleId'],
          'O módulo do passo deve pertencer ao componente informado.',
        );
      }
    });
    validateReferences(issues, flow.acceptanceCriteriaIds, acceptanceCriterionIds, [
      'flows',
      index,
      'acceptanceCriteriaIds',
    ]);
  });

  specification.contracts.forEach((contract, index) => {
    validateScalarReference(issues, contract.ownerComponentId, componentIds, [
      'contracts',
      index,
      'ownerComponentId',
    ]);
    validateReferences(issues, contract.consumerComponentIds, componentIds, [
      'contracts',
      index,
      'consumerComponentIds',
    ]);
  });
  specification.apis.forEach((api, index) => {
    validateScalarReference(issues, api.componentId, componentIds, ['apis', index, 'componentId']);
    validateNullableReference(issues, api.requestContractId, contractIds, [
      'apis',
      index,
      'requestContractId',
    ]);
    validateNullableReference(issues, api.responseContractId, contractIds, [
      'apis',
      index,
      'responseContractId',
    ]);
    validateReferences(issues, api.acceptanceCriteriaIds, acceptanceCriterionIds, [
      'apis',
      index,
      'acceptanceCriteriaIds',
    ]);
  });
  specification.events.forEach((event, index) => {
    validateScalarReference(issues, event.producerComponentId, componentIds, [
      'events',
      index,
      'producerComponentId',
    ]);
    validateReferences(issues, event.consumerComponentIds, componentIds, [
      'events',
      index,
      'consumerComponentIds',
    ]);
    validateNullableReference(issues, event.payloadContractId, contractIds, [
      'events',
      index,
      'payloadContractId',
    ]);
    validateReferences(issues, event.acceptanceCriteriaIds, acceptanceCriterionIds, [
      'events',
      index,
      'acceptanceCriteriaIds',
    ]);
  });

  specification.dataModel.entities.forEach((entity, index) => {
    validateNullableReference(issues, entity.moduleId, moduleIds, [
      'dataModel',
      'entities',
      index,
      'moduleId',
    ]);
  });
  specification.dataModel.relations.forEach((relation, index) => {
    validateScalarReference(issues, relation.sourceEntityId, entityIds, [
      'dataModel',
      'relations',
      index,
      'sourceEntityId',
    ]);
    validateScalarReference(issues, relation.targetEntityId, entityIds, [
      'dataModel',
      'relations',
      index,
      'targetEntityId',
    ]);
  });
  if (
    (!specification.dataModel.changesRequired &&
      (specification.dataModel.migrationRequired ||
        specification.dataModel.entities.length > 0 ||
        specification.dataModel.relations.length > 0)) ||
    (specification.dataModel.changesRequired && specification.dataModel.entities.length === 0)
  ) {
    addIssue(
      issues,
      DEVELOPER_BUSINESS_VALIDATION_ISSUE_CODES.DATA_MODEL_MISMATCH,
      ['dataModel'],
      'Os indicadores de mudança devem corresponder às entidades e relações declaradas.',
    );
  }

  specification.internalDependencies.forEach((dependency, index) => {
    validateScalarReference(issues, dependency.componentId, componentIds, [
      'internalDependencies',
      index,
      'componentId',
    ]);
  });
  specification.externalDependencies.forEach((dependency, index) => {
    validateScalarReference(issues, dependency.componentId, componentIds, [
      'externalDependencies',
      index,
      'componentId',
    ]);
  });
  specification.risks.forEach((risk, index) => {
    validateReferences(issues, risk.componentIds ?? [], componentIds, [
      'risks',
      index,
      'componentIds',
    ]);
  });

  validateContiguousOrder(issues, specification.implementationPhases, ['implementationPhases']);
  validateContiguousOrder(issues, specification.implementationPlan, ['implementationPlan']);
  specification.implementationPhases.forEach((phase, index) => {
    validateReferences(issues, phase.dependsOnPhaseIds, phaseIds, [
      'implementationPhases',
      index,
      'dependsOnPhaseIds',
    ]);
  });
  specification.implementationPlan.forEach((item, index) => {
    validateScalarReference(issues, item.phaseId, phaseIds, [
      'implementationPlan',
      index,
      'phaseId',
    ]);
    validateReferences(issues, item.componentIds ?? [], componentIds, [
      'implementationPlan',
      index,
      'componentIds',
    ]);
    validateReferences(issues, item.moduleIds ?? [], moduleIds, [
      'implementationPlan',
      index,
      'moduleIds',
    ]);
    validateReferences(issues, item.dependsOnPlanItemIds, planIds, [
      'implementationPlan',
      index,
      'dependsOnPlanItemIds',
    ]);
    validateReferences(issues, item.acceptanceCriteriaIds ?? [], acceptanceCriterionIds, [
      'implementationPlan',
      index,
      'acceptanceCriteriaIds',
    ]);
  });
  specification.technicalBacklog.forEach((item, index) => {
    validateReferences(issues, item.implementationPlanIds, planIds, [
      'technicalBacklog',
      index,
      'implementationPlanIds',
    ]);
    validateReferences(issues, item.dependsOnBacklogItemIds, backlogIds, [
      'technicalBacklog',
      index,
      'dependsOnBacklogItemIds',
    ]);
    validateReferences(issues, item.acceptanceCriteriaIds, acceptanceCriterionIds, [
      'technicalBacklog',
      index,
      'acceptanceCriteriaIds',
    ]);
  });
  specification.definitionOfDone.forEach((item, index) => {
    validateReferences(issues, item.acceptanceCriteriaIds, acceptanceCriterionIds, [
      'definitionOfDone',
      index,
      'acceptanceCriteriaIds',
    ]);
  });
  specification.decisions.forEach((decision, index) => {
    validateReferences(issues, decision.componentIds ?? [], componentIds, [
      'decisions',
      index,
      'componentIds',
    ]);
    validateReferences(issues, decision.moduleIds ?? [], moduleIds, [
      'decisions',
      index,
      'moduleIds',
    ]);
  });

  validateDependencyGraph(
    issues,
    'components',
    'dependsOnComponentIds',
    specification.components,
    (value) =>
      (value as DeveloperBusinessValidationInput['components'][number]).dependsOnComponentIds,
  );
  validateDependencyGraph(
    issues,
    'modules',
    'dependsOnModuleIds',
    specification.modules,
    (value) => (value as DeveloperBusinessValidationInput['modules'][number]).dependsOnModuleIds,
  );
  validateDependencyGraph(
    issues,
    'implementationPhases',
    'dependsOnPhaseIds',
    specification.implementationPhases,
    (value) =>
      (value as DeveloperBusinessValidationInput['implementationPhases'][number]).dependsOnPhaseIds,
  );
  validateDependencyGraph(
    issues,
    'implementationPlan',
    'dependsOnPlanItemIds',
    specification.implementationPlan,
    (value) =>
      (value as DeveloperBusinessValidationInput['implementationPlan'][number])
        .dependsOnPlanItemIds,
  );
  validateDependencyGraph(
    issues,
    'technicalBacklog',
    'dependsOnBacklogItemIds',
    specification.technicalBacklog,
    (value) =>
      (value as DeveloperBusinessValidationInput['technicalBacklog'][number])
        .dependsOnBacklogItemIds,
  );

  validateTraceability(
    specification,
    productOwnerSpecification,
    {
      sources: functionalSourceIds,
      acceptanceCriteria: acceptanceCriterionIds,
      components: componentIds,
      modules: moduleIds,
      flows: flowIds,
      contracts: contractIds,
      apis: apiIds,
      events: eventIds,
      plans: planIds,
      backlog: backlogIds,
      definitionOfDone: definitionOfDoneIds,
    },
    issues,
  );

  const expectedReadiness = deriveDeveloperReadiness(
    productOwnerSpecification.readiness,
    specification.openQuestions,
    specification.assumptions,
  );
  if (specification.readiness !== expectedReadiness) {
    addIssue(
      issues,
      DEVELOPER_BUSINESS_VALIDATION_ISSUE_CODES.READINESS_MISMATCH,
      ['readiness'],
      'readiness deve refletir a especificação funcional e as pendências técnicas.',
    );
  }
  validateCompleteness(specification, expectedReadiness, issues);

  const boundedIssues = issues.slice(0, DEVELOPER_BUSINESS_VALIDATION_MAX_ISSUES);
  return deepFreeze({
    valid: boundedIssues.length === 0,
    expectedReadiness,
    issues: boundedIssues,
    issuesTruncated: issues.length > boundedIssues.length,
  });
}
