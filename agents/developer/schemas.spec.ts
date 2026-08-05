import { productOwnerSpecificationSchema } from '@brq/product-owner-agent';
import { describe, expect, it } from 'vitest';

import {
  developerAgentRequestSchema,
  developerBusinessValidationResultSchema,
  technicalSpecificationSchema,
  technicalSpecificationStructureSchema,
} from './schemas';

function productOwnerSpecification() {
  return productOwnerSpecificationSchema.parse({
    readiness: 'READY',
    title: 'Demanda funcional',
    summary: 'Resumo funcional.',
    objective: 'Entregar comportamento verificável.',
    context: 'Contexto funcional conhecido.',
    userStory: { asA: 'pessoa', iWant: 'agir', soThat: 'obtenha valor' },
    acceptanceCriteria: [
      { id: 'AC-001', given: 'um estado', when: 'uma ação', then: 'um resultado' },
    ],
    businessRules: [
      {
        id: 'BR-001',
        description: 'Regra conhecida.',
        source: null,
        condition: null,
        impact: 'LOW',
      },
    ],
    scenarios: [
      {
        id: 'SCN-001',
        title: 'Fluxo principal',
        type: 'MAIN',
        given: ['um estado'],
        when: ['uma ação'],
        then: ['um resultado'],
        acceptanceCriteriaIds: ['AC-001'],
      },
    ],
    assumptions: [],
    dependencies: [],
    risks: [],
    openQuestions: [],
    outOfScope: [],
    definitionOfReady: [{ id: 'DOR-001', criterion: 'Especificação revisada.' }],
    backlogItems: [
      {
        id: 'BL-001',
        title: 'Entregar valor',
        description: 'Implementar o fluxo funcional.',
        priority: 'HIGH',
        dependencyIds: [],
        acceptanceCriteriaIds: ['AC-001'],
      },
    ],
  });
}

function technicalSpecification(overrides: Record<string, unknown> = {}) {
  return {
    readiness: 'READY',
    title: 'Especificação técnica',
    summary: 'Resumo técnico proporcional ao escopo.',
    objective: 'Orientar a implementação sem produzir código.',
    complexity: 'LOW',
    estimatedStoryPoints: 3,
    architecture: {
      overview: 'Um módulo local atende ao fluxo.',
      style: 'Modular',
      rationale: 'A solução minimiza acoplamento e escopo.',
      principles: ['Separação de responsabilidades.'],
      constraints: ['Preservar as fronteiras existentes.'],
      qualityAttributes: ['Determinismo.'],
      trustBoundaries: ['Entrada funcional não confiável.'],
    },
    components: [
      {
        id: 'CMP-001',
        name: 'Aplicação',
        kind: 'APPLICATION',
        changeType: 'MODIFY',
        responsibility: 'Coordenar o comportamento técnico.',
        moduleIds: ['MOD-001'],
        dependsOnComponentIds: [],
      },
    ],
    modules: [
      {
        id: 'MOD-001',
        name: 'Módulo de domínio',
        path: 'core/example',
        changeType: 'MODIFY',
        responsibility: 'Implementar o comportamento.',
        componentId: 'CMP-001',
        dependsOnModuleIds: [],
      },
    ],
    flows: [
      {
        id: 'FLW-001',
        name: 'Fluxo principal',
        description: 'Processa a ação esperada.',
        steps: [
          {
            order: 1,
            componentId: 'CMP-001',
            moduleId: 'MOD-001',
            action: 'Validar e processar a entrada.',
          },
        ],
        acceptanceCriteriaIds: ['AC-001'],
      },
    ],
    contracts: [
      {
        id: 'CTR-001',
        name: 'Contrato principal',
        kind: 'INTERNAL',
        description: 'Dados necessários ao fluxo.',
        ownerComponentId: 'CMP-001',
        consumerComponentIds: [],
      },
    ],
    apis: [
      {
        id: 'API-001',
        name: 'Endpoint principal',
        method: 'POST',
        path: '/example',
        description: 'Recebe a ação.',
        componentId: 'CMP-001',
        requestContractId: 'CTR-001',
        responseContractId: 'CTR-001',
        acceptanceCriteriaIds: ['AC-001'],
      },
    ],
    events: [
      {
        id: 'EVT-001',
        name: 'Evento principal',
        description: 'Representa a conclusão do fluxo.',
        producerComponentId: 'CMP-001',
        consumerComponentIds: [],
        payloadContractId: 'CTR-001',
        acceptanceCriteriaIds: ['AC-001'],
      },
    ],
    dataModel: { changesRequired: false, migrationRequired: false, entities: [], relations: [] },
    internalDependencies: [
      {
        id: 'IDEP-001',
        name: 'Componente local',
        description: 'Dependência já disponível.',
        componentId: 'CMP-001',
        status: 'AVAILABLE',
        blocking: false,
      },
    ],
    externalDependencies: [
      {
        id: 'EDEP-001',
        name: 'Serviço externo',
        description: 'Integração conhecida.',
        componentId: 'CMP-001',
        kind: 'SERVICE',
        status: 'AVAILABLE',
        blocking: false,
      },
    ],
    risks: [
      {
        id: 'TRSK-001',
        description: 'Mudança externa pode afetar o fluxo.',
        impact: 'LOW',
        likelihood: 'LOW',
        mitigation: null,
        componentIds: ['CMP-001'],
      },
    ],
    implementationPhases: [
      {
        id: 'PH-001',
        order: 1,
        name: 'Implementação',
        objective: 'Entregar o fluxo principal.',
        dependsOnPhaseIds: [],
      },
    ],
    implementationPlan: [
      {
        id: 'PLAN-001',
        order: 1,
        title: 'Implementar fluxo',
        description: 'Alterar o módulo necessário.',
        phaseId: 'PH-001',
        componentIds: ['CMP-001'],
        moduleIds: ['MOD-001'],
        dependsOnPlanItemIds: [],
        acceptanceCriteriaIds: ['AC-001'],
      },
    ],
    technicalBacklog: [
      {
        id: 'TBL-001',
        title: 'Fluxo principal',
        description: 'Implementar o comportamento esperado.',
        priority: 'HIGH',
        implementationPlanIds: ['PLAN-001'],
        dependsOnBacklogItemIds: [],
        acceptanceCriteriaIds: ['AC-001'],
      },
    ],
    definitionOfDone: [
      {
        id: 'DOD-001',
        criterion: 'Critério de aceite atendido.',
        acceptanceCriteriaIds: ['AC-001'],
      },
    ],
    decisions: [
      {
        id: 'DEC-001',
        title: 'Preservar módulo',
        context: 'O módulo já possui a responsabilidade necessária.',
        decision: 'Evoluir o módulo existente.',
        alternatives: ['Criar um novo módulo.'],
        tradeOffs: [{ benefit: 'Menor escopo.', cost: 'Maior atenção à compatibilidade.' }],
        rationale: 'Evita abstração prematura.',
        requiresAdr: false,
        componentIds: ['CMP-001'],
        moduleIds: ['MOD-001'],
      },
    ],
    traceability: [
      {
        id: 'TRC-001',
        sourceIds: ['AC-001', 'BR-001', 'BL-001'],
        componentIds: ['CMP-001'],
        moduleIds: ['MOD-001'],
        flowIds: ['FLW-001'],
        contractIds: ['CTR-001'],
        apiIds: ['API-001'],
        eventIds: ['EVT-001'],
        implementationPlanIds: ['PLAN-001'],
        technicalBacklogIds: ['TBL-001'],
        definitionOfDoneIds: ['DOD-001'],
      },
    ],
    assumptions: [
      {
        id: 'TASM-001',
        description: 'A arquitetura permanece estável.',
        requiresValidation: false,
      },
    ],
    openQuestions: [],
    outOfScope: [{ id: 'TOOS-001', description: 'Código e testes.' }],
    ...overrides,
  };
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    context: {
      executionId: 'execution-1',
      agentExecutionId: 'agent-execution-1',
      attempt: 1,
      agentVersion: '1.0.0',
      requestId: 'request-1',
      traceId: 'trace-1',
    },
    productOwnerSpecification: productOwnerSpecification(),
    model: 'configured-model',
    limits: {
      knowledgeMaxDocuments: 24,
      knowledgeMaxBytes: 64 * 1024,
      promptMaxBytes: 128 * 1024,
      maxOutputTokens: 8_192,
      timeoutMs: 60_000,
    },
    ...overrides,
  };
}

describe('Developer schemas', () => {
  it('accepts the canonical request with only context, source specification, model and limits', () => {
    expect(developerAgentRequestSchema.safeParse(request()).success).toBe(true);
    expect(
      developerAgentRequestSchema.safeParse({ ...request(), additionalContext: 'não permitido' })
        .success,
    ).toBe(false);
    expect(
      developerAgentRequestSchema.safeParse({ ...request(), demand: { title: 'duplicada' } })
        .success,
    ).toBe(false);
  });

  it('enforces request limits and rejects silent model normalization', () => {
    expect(developerAgentRequestSchema.safeParse(request({ model: ' model ' })).success).toBe(
      false,
    );
    expect(
      developerAgentRequestSchema.safeParse(
        request({ limits: { ...request().limits, timeoutMs: 999 } }),
      ).success,
    ).toBe(false);
    expect(
      developerAgentRequestSchema.safeParse(
        request({ limits: { ...request().limits, timeoutMs: 600_001 } }),
      ).success,
    ).toBe(false);
  });

  it('accepts the complete strict technical specification', () => {
    expect(technicalSpecificationStructureSchema.safeParse(technicalSpecification()).success).toBe(
      true,
    );
    expect(technicalSpecificationSchema.safeParse(technicalSpecification()).success).toBe(true);
  });

  it('rejects unknown properties at top-level and nested levels', () => {
    expect(
      technicalSpecificationSchema.safeParse(technicalSpecification({ code: 'const x = 1;' }))
        .success,
    ).toBe(false);

    const candidate = technicalSpecification();
    expect(
      technicalSpecificationSchema.safeParse({
        ...candidate,
        architecture: { ...candidate.architecture, tests: ['não permitido'] },
      }).success,
    ).toBe(false);
  });

  it('enforces story-point bounds and required trade-offs', () => {
    expect(
      technicalSpecificationSchema.safeParse(technicalSpecification({ estimatedStoryPoints: 1 }))
        .success,
    ).toBe(true);
    expect(
      technicalSpecificationSchema.safeParse(technicalSpecification({ estimatedStoryPoints: 100 }))
        .success,
    ).toBe(true);
    expect(
      technicalSpecificationSchema.safeParse(technicalSpecification({ estimatedStoryPoints: 0 }))
        .success,
    ).toBe(false);
    expect(
      technicalSpecificationSchema.safeParse(technicalSpecification({ estimatedStoryPoints: 101 }))
        .success,
    ).toBe(false);

    const candidate = technicalSpecification();
    expect(
      technicalSpecificationSchema.safeParse({
        ...candidate,
        decisions: [{ ...candidate.decisions[0], tradeOffs: [] }],
      }).success,
    ).toBe(false);
  });

  it.each([
    '/absolute/path',
    'C:/absolute/path',
    '../escape',
    'core/../escape',
    'core\\module',
    'core//module',
  ])('rejects unsafe logical module path %s', (path) => {
    const candidate = technicalSpecification();
    expect(
      technicalSpecificationSchema.safeParse({
        ...candidate,
        modules: [{ ...candidate.modules[0], path }],
      }).success,
    ).toBe(false);
  });

  it('enforces collection bounds and strict source ID formats', () => {
    const candidate = technicalSpecification();
    const components = Array.from({ length: 31 }, (_, index) => ({
      ...candidate.components[0],
      id: `CMP-${String(index + 1).padStart(3, '0')}`,
    }));
    expect(
      technicalSpecificationSchema.safeParse(technicalSpecification({ components })).success,
    ).toBe(false);
    expect(
      technicalSpecificationSchema.safeParse({
        ...candidate,
        traceability: [{ ...candidate.traceability[0], sourceIds: ['DEP-001'] }],
      }).success,
    ).toBe(false);
  });

  it('validates coherence of the public Business Validation result', () => {
    const valid = {
      valid: true,
      expectedReadiness: 'READY',
      issues: [],
      issuesTruncated: false,
    };
    expect(developerBusinessValidationResultSchema.safeParse(valid).success).toBe(true);
    expect(
      developerBusinessValidationResultSchema.safeParse({ ...valid, valid: false }).success,
    ).toBe(false);
    expect(
      developerBusinessValidationResultSchema.safeParse({
        ...valid,
        expectedReadiness: null,
      }).success,
    ).toBe(false);
    expect(
      developerBusinessValidationResultSchema.safeParse({ ...valid, issuesTruncated: true })
        .success,
    ).toBe(false);
  });
});
