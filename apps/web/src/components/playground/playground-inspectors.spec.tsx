import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  PlaygroundBuiltPreview,
  PlaygroundPipelineNode,
  PlaygroundValidation,
} from '@/api/playground-contracts';

import { AgentSelector } from './agent-selector';
import { BudgetMeter } from './budget-meter';
import { HashInspector } from './hash-inspector';
import { KnowledgeInspector } from './knowledge-inspector';
import { OutputContractInspector } from './output-contract-inspector';
import { PipelineNodeDetails, PipelineVisualization } from './pipeline-visualization';
import { emptyPlaygroundDraft } from './playground-input-form';
import {
  EmptyInspectorState,
  PlaygroundErrorState,
  PlaygroundLoadingState,
} from './playground-state';
import { PromptPreview } from './prompt-preview';
import {
  builtPreviewFixture,
  outputContractFixture,
  playgroundCatalogFixture,
  validationFixture,
} from './playground.spec.fixtures';
import { TrustBoundaries } from './trust-boundaries';
import { ValidationWorkspace } from './validation-pipeline';

afterEach(cleanup);

describe('PromptPreview', () => {
  it('switches read-only channels while rendering hostile-looking content as text', () => {
    render(
      <PromptPreview
        prompt={{
          instructions: '<img src=x onerror="globalThis.pwned=true">',
          input: '{"objective":"inspect"}',
        }}
      />,
    );

    expect(screen.getByText(/<img src=x/)).toBeVisible();
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByRole('tabpanel')).toHaveAttribute(
      'aria-labelledby',
      'prompt-preview-tab-instructions',
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Input' }));
    expect(screen.getByText('{"objective":"inspect"}')).toBeVisible();
    expect(screen.getByRole('tabpanel')).toHaveAttribute('id', 'prompt-preview-panel-input');
  });
});

describe('OutputContractInspector', () => {
  it('renders the complete projected schema summary', () => {
    const contract = outputContractFixture();
    contract.summary.nodes.push({
      path: '$.metadata',
      types: [],
      required: false,
      enumValues: [],
      constraints: [],
    });
    render(<OutputContractInspector contract={contract} />);

    expect(screen.getByText('Return exactly one JSON object.')).toBeVisible();
    expect(screen.getByText('object · required')).toBeVisible();
    expect(screen.getByText('untyped · optional')).toBeVisible();
    expect(screen.getByText('Enum: "READY", "BLOCKED"')).toBeVisible();
    expect(screen.getByText('Constraints: additionalProperties=false')).toBeVisible();
    fireEvent.click(screen.getByText('View read-only JSON Schema'));
    expect(screen.getByText(/"required": \[/)).toBeVisible();
  });

  it('handles a text contract with no schema details and a truncated empty summary', () => {
    const source = outputContractFixture();
    const contract: PlaygroundBuiltPreview['outputContract'] = {
      ...source,
      format: 'TEXT',
      dialect: null,
      schemaHash: null,
      instructions: [],
      schema: null,
      summary: {
        ...source.summary,
        rootTypes: [],
        totalNodes: 0,
        propertyCount: 0,
        requiredCount: 0,
        objectCount: 0,
        enumCount: 0,
        truncated: true,
        nodes: [],
      },
    };
    render(<OutputContractInspector contract={contract} />);

    expect(screen.getByLabelText('Schema summary')).toHaveTextContent('Root typesNone');
    expect(screen.getAllByText('Not applicable')).toHaveLength(2);
    expect(screen.getByText(/schema summary was truncated/i)).toBeVisible();
    expect(
      screen.queryByRole('heading', { name: 'Contract instructions' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Schema nodes' })).not.toBeInTheDocument();
    expect(screen.queryByText('View read-only JSON Schema')).not.toBeInTheDocument();
  });
});

describe('ValidationWorkspace', () => {
  it('renders the pristine pipeline and forwards candidate edits and validation', () => {
    const onChange = vi.fn();
    const onValidate = vi.fn();
    render(
      <ValidationWorkspace
        disabled={false}
        draft={emptyPlaygroundDraft()}
        error={null}
        onChange={onChange}
        onValidate={onValidate}
        result={null}
      />,
    );

    expect(screen.getByText('Not run')).toBeVisible();
    expect(screen.getAllByText('NOT_RUN')).toHaveLength(4);
    const candidate = screen.getByLabelText('Candidate response');
    expect(candidate).toHaveAttribute('aria-invalid', 'false');
    expect(candidate).not.toHaveAttribute('aria-describedby');
    fireEvent.change(candidate, { target: { value: '{"status":"READY"}' } });
    expect(onChange).toHaveBeenCalledWith({
      ...emptyPlaygroundDraft(),
      candidate: '{"status":"READY"}',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Validate candidate' }));
    expect(onValidate).toHaveBeenCalledOnce();
  });

  it('exposes disabled and inline error semantics', () => {
    render(
      <ValidationWorkspace
        disabled
        draft={emptyPlaygroundDraft()}
        error="Candidate is required."
        onChange={vi.fn()}
        onValidate={vi.fn()}
        result={null}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Candidate is required.');
    expect(screen.getByLabelText('Candidate response')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Candidate response')).toHaveAttribute(
      'aria-describedby',
      'validation-candidate-error',
    );
    expect(screen.getByLabelText('Candidate response')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Validating…' })).toBeDisabled();
  });

  it('formats root and escaped JSON pointer paths and reports truncated issues', () => {
    const base = validationFixture('FAIL');
    const result: PlaygroundValidation = {
      ...base,
      stages: base.stages.map((stage, index) =>
        index === 0
          ? {
              ...stage,
              issuesTruncated: true,
              issues: [
                {
                  code: 'ROOT_INVALID',
                  path: [],
                  keyword: null,
                  message: 'The root value is invalid.',
                },
                {
                  code: 'ESCAPED_PATH',
                  path: ['a/b', 'c~d', 0],
                  keyword: 'type',
                  message: 'Nested value is invalid.',
                },
              ],
            }
          : stage,
      ),
    };
    render(
      <ValidationWorkspace
        disabled={false}
        draft={{ ...emptyPlaygroundDraft(), candidate: '{}' }}
        error={null}
        onChange={vi.fn()}
        onValidate={vi.fn()}
        result={result}
      />,
    );

    expect(screen.getByText('/', { selector: 'span' })).toBeVisible();
    expect(screen.getByText('/a~1b/c~0d/0')).toBeVisible();
    expect(screen.getByText('Keyword: type')).toBeVisible();
    expect(screen.getAllByText(/Keyword:/)).toHaveLength(1);
    expect(screen.getByText('Additional issues were omitted.')).toBeVisible();
    expect(screen.getAllByText(base.candidateHash)).toHaveLength(2);
  });
});

describe('BudgetMeter', () => {
  it('renders a valid budget and byte units', () => {
    render(<BudgetMeter budget={builtPreviewFixture().budget} />);

    expect(screen.getByText('Within limit')).toHaveAttribute('data-warning', 'false');
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '2048');
    expect(screen.getByText(/2\.0 KiB/)).toBeVisible();
    expect(screen.getAllByText('512 B')).toHaveLength(2);
    expect(screen.queryByText(/approaching the configured/)).not.toBeInTheDocument();
  });

  it('warns near the limit, clamps progress, and rounds larger KiB values', () => {
    const budget: PlaygroundBuiltPreview['budget'] = {
      ...builtPreviewFixture().budget,
      maxBytes: 10_240,
      usedBytes: 12_288,
      remainingBytes: 0,
      utilizationPercent: 100,
      instructionsBytes: 512,
      inputBytes: 1_536,
      outputContractBytes: 10_240,
      status: 'WARNING',
    };
    render(<BudgetMeter budget={budget} />);

    expect(screen.getByText('Near limit')).toHaveAttribute('data-warning', 'true');
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '10240');
    expect(screen.getByText('12 KiB', { selector: 'strong' })).toBeVisible();
    expect(screen.getByText('1.5 KiB')).toBeVisible();
    expect(screen.getByText('12 KiB', { selector: 'strong' }).closest('p')).toHaveTextContent(
      '12 KiB / 10 KiB · 100.0%',
    );
    expect(screen.getByText('10 KiB', { selector: 'dd' })).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent(
      'approaching the configured runtime limit',
    );
  });
});

describe('knowledge, hashes, pipeline, and trust projections', () => {
  it('renders the no-document knowledge state without exception groups', () => {
    const source = builtPreviewFixture().knowledge;
    render(
      <KnowledgeInspector knowledge={{ ...source, documents: [], ignored: [], missing: [] }} />,
    );

    expect(screen.getByText('No knowledge documents were selected.')).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Ignored' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Missing' })).not.toBeInTheDocument();
  });

  it('renders selected, ignored, and required or optional missing knowledge metadata', () => {
    const source = builtPreviewFixture().knowledge;
    render(
      <KnowledgeInspector
        knowledge={{
          ...source,
          ignored: [
            { id: null, reason: 'NOT_IN_MANIFEST' },
            { id: 'over-budget', reason: 'BUDGET_EXCEEDED' },
          ],
          missing: [
            { id: 'required-policy', required: true },
            { id: 'optional-guide', required: false },
          ],
        }}
      />,
    );

    expect(screen.getByRole('cell', { name: 'knowledge-security' })).toBeVisible();
    expect(screen.getByText(/Unknown document/)).toBeVisible();
    expect(screen.getByText(/over-budget/)).toBeVisible();
    expect(screen.getByText(/required-policy/).closest('li')).toHaveTextContent('REQUIRED');
    expect(screen.getByText(/optional-guide/).closest('li')).toHaveTextContent('OPTIONAL');
  });

  it('renders primary hashes and distinguishes source content hashes', () => {
    const hashes = builtPreviewFixture().hashes;
    render(<HashInspector hashes={hashes} />);

    expect(screen.getByText('Asset bundle')).toBeVisible();
    const sources = screen.getByRole('heading', { name: 'Resolved sources' }).nextElementSibling;
    expect(sources).not.toBeNull();
    expect(within(sources as HTMLElement).getByText('global')).toBeVisible();
    expect(within(sources as HTMLElement).getByText('knowledge')).toBeVisible();
    expect(within(sources as HTMLElement).getAllByText(/^Content:/)).toHaveLength(1);
  });

  it('reports idle and resolved pipeline states, statuses, selection, and details', () => {
    const idle = playgroundCatalogFixture().pipeline;
    const onSelect = vi.fn();
    const { rerender } = render(
      <>
        <PipelineVisualization nodes={idle} onSelect={onSelect} selected="KNOWLEDGE" />
        <PipelineNodeDetails node={idle[0]!} />
      </>,
    );

    expect(screen.getByText('Awaiting build')).toBeVisible();
    expect(screen.getByRole('button', { name: /KNOWLEDGE\s*Idle/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByText('This stage has not run yet.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /RULES\s*Idle/i }));
    expect(onSelect).toHaveBeenCalledWith('RULES');

    const statuses = ['VALID', 'WARNING', 'ERROR', 'IDLE'] as const;
    const resolved: PlaygroundPipelineNode[] = idle.map((node, index) => ({
      ...node,
      status: statuses[index % statuses.length]!,
      detail: `${node.stage} detail`,
    }));
    rerender(
      <>
        <PipelineVisualization nodes={resolved} onSelect={onSelect} selected="RULES" />
        <PipelineNodeDetails node={resolved[1]!} />
      </>,
    );
    expect(screen.getByText('Resolved')).toBeVisible();
    expect(screen.getByRole('button', { name: /RULES\s*Warning/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: /TEMPLATE\s*Error/i })).toBeVisible();
    expect(screen.getByText('RULES detail')).toBeVisible();
  });

  it('renders known trust sections and safe fallbacks for unknown identifiers', () => {
    const preview = builtPreviewFixture();
    render(
      <TrustBoundaries
        boundaries={{
          trustedSectionIds: [...preview.trustBoundaries.trustedSectionIds, 'missing-trusted'],
          untrustedSectionIds: [
            ...preview.trustBoundaries.untrustedSectionIds,
            'missing-untrusted',
          ],
        }}
        sections={preview.sections}
      />,
    );

    expect(screen.getByText('GLOBAL_RULES')).toBeVisible();
    expect(screen.getByText('USER_INPUT')).toBeVisible();
    expect(screen.getByText('missing-trusted')).toBeVisible();
    expect(screen.getByText('Unknown channel · missing-trusted')).toBeVisible();
    expect(screen.getByText('Unknown channel · missing-untrusted')).toBeVisible();
  });
});

describe('small Playground states and agent selection', () => {
  it('renders loading and empty inspector states', () => {
    const { rerender } = render(<PlaygroundLoadingState />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByText('Loading inspection catalog')).toBeVisible();

    rerender(<EmptyInspectorState title="Contract is idle" />);
    expect(screen.getByRole('status')).toHaveTextContent('Contract is idle');
    expect(screen.getByRole('status')).toHaveTextContent('build a preview');
  });

  it('renders errors with and without an optional retry action', () => {
    const onRetry = vi.fn();
    const { rerender } = render(<PlaygroundErrorState message="Temporarily unavailable." />);
    expect(screen.getByRole('alert')).toHaveTextContent('Temporarily unavailable.');
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();

    rerender(<PlaygroundErrorState message="Try again." onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('marks the selected agent and forwards radio changes', () => {
    const agents = playgroundCatalogFixture().agents;
    const onChange = vi.fn();
    const { rerender } = render(
      <AgentSelector agents={agents} disabled={false} onChange={onChange} value="PRODUCT_OWNER" />,
    );

    expect(screen.getByRole('radio', { name: /Product Owner/i })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: /Developer/i }));
    expect(onChange).toHaveBeenCalledWith('DEVELOPER');

    rerender(<AgentSelector agents={agents} disabled onChange={onChange} value="QA" />);
    expect(screen.getByRole('radio', { name: /^QA/i })).toBeChecked();
    screen.getAllByRole('radio').forEach((radio) => expect(radio).toBeDisabled());
  });
});
