import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PlaygroundAgent, PlaygroundExample } from '@/api/playground-contracts';

import {
  draftFromExample,
  emptyPlaygroundDraft,
  PlaygroundInputForm,
  requestFromDraft,
  type PlaygroundDraft,
} from './playground-input-form';
import { playgroundCatalogFixture } from './playground.spec.fixtures';

afterEach(cleanup);

function exampleFor(agent: PlaygroundAgent): PlaygroundExample {
  const descriptor = playgroundCatalogFixture().agents.find((item) => item.agent === agent);
  const example = descriptor?.examples[0];
  if (example === undefined) throw new Error(`Missing ${agent} fixture`);
  return example;
}

function renderForm(overrides: Partial<ComponentProps<typeof PlaygroundInputForm>> = {}) {
  const props: ComponentProps<typeof PlaygroundInputForm> = {
    agent: 'PRODUCT_OWNER',
    disabled: false,
    draft: emptyPlaygroundDraft(),
    error: null,
    example: exampleFor('PRODUCT_OWNER'),
    onBuild: vi.fn(),
    onChange: vi.fn(),
    onLoadExample: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<PlaygroundInputForm {...props} />) };
}

describe('playground input conversions', () => {
  it('creates an empty draft and maps every valid catalog example', () => {
    expect(emptyPlaygroundDraft()).toEqual({
      projectName: '',
      objective: '',
      productOwnerSpecification: '',
      technicalSpecification: '',
      candidate: '',
    });
    expect(draftFromExample('PRODUCT_OWNER', exampleFor('PRODUCT_OWNER'))).toMatchObject({
      projectName: 'Customer Portal',
      objective: 'Track customer orders.',
      candidate: '{"title":"Order tracking"}',
    });
    expect(draftFromExample('DEVELOPER', exampleFor('DEVELOPER'))).toMatchObject({
      productOwnerSpecification: '{\n  "title": "Order tracking"\n}',
      candidate: '{"architecture":"modular"}',
    });
    expect(draftFromExample('QA', exampleFor('QA'))).toMatchObject({
      productOwnerSpecification: '{\n  "title": "Order tracking"\n}',
      technicalSpecification: '{\n  "architecture": "modular"\n}',
      candidate: '{"strategy":"risk based"}',
    });
  });

  it('falls back to a blank draft for malformed or mismatched examples', () => {
    const base = exampleFor('PRODUCT_OWNER');
    expect(draftFromExample('PRODUCT_OWNER', { ...base, input: null })).toEqual(
      emptyPlaygroundDraft(),
    );
    expect(draftFromExample('PRODUCT_OWNER', { ...base, input: [] })).toEqual(
      emptyPlaygroundDraft(),
    );
    expect(
      draftFromExample('PRODUCT_OWNER', { ...base, input: { projectName: 42, objective: 'x' } }),
    ).toEqual(emptyPlaygroundDraft());
    expect(draftFromExample('DEVELOPER', base)).toEqual(emptyPlaygroundDraft());
    expect(
      draftFromExample('QA', {
        ...base,
        input: { productOwnerSpecification: { title: 'Only one handoff' } },
      }),
    ).toEqual(emptyPlaygroundDraft());
  });

  it('uses an empty candidate when the example does not provide one', () => {
    const example = exampleFor('DEVELOPER');
    const withoutCandidate: PlaygroundExample = {
      id: example.id,
      label: example.label,
      description: example.description,
      input: example.input,
    };
    expect(draftFromExample('DEVELOPER', withoutCandidate).candidate).toBe('');
  });

  it('trims Product Owner fields and builds Developer and QA requests', () => {
    expect(
      requestFromDraft('PRODUCT_OWNER', {
        ...emptyPlaygroundDraft(),
        projectName: '  Portal  ',
        objective: '\n Track orders.  ',
      }),
    ).toEqual({
      agent: 'PRODUCT_OWNER',
      input: { projectName: 'Portal', objective: 'Track orders.' },
    });
    expect(
      requestFromDraft('DEVELOPER', {
        ...emptyPlaygroundDraft(),
        productOwnerSpecification: '{"title":"Orders"}',
      }),
    ).toEqual({
      agent: 'DEVELOPER',
      input: { productOwnerSpecification: { title: 'Orders' } },
    });
    expect(
      requestFromDraft('QA', {
        ...emptyPlaygroundDraft(),
        productOwnerSpecification: '{"title":"Orders"}',
        technicalSpecification: '{"runtime":"node"}',
      }),
    ).toEqual({
      agent: 'QA',
      input: {
        productOwnerSpecification: { title: 'Orders' },
        technicalSpecification: { runtime: 'node' },
      },
    });
  });

  it('rejects incomplete Product Owner input', () => {
    expect(() => requestFromDraft('PRODUCT_OWNER', emptyPlaygroundDraft())).toThrow(
      'Project name and objective are required.',
    );
  });

  it.each([
    ['not JSON', 'Product Owner specification must contain valid JSON.'],
    ['null', 'Product Owner specification must be a JSON object.'],
    ['42', 'Product Owner specification must be a JSON object.'],
    ['[]', 'Product Owner specification must be a JSON object.'],
  ])('rejects invalid Developer JSON: %s', (value, message) => {
    expect(() =>
      requestFromDraft('DEVELOPER', {
        ...emptyPlaygroundDraft(),
        productOwnerSpecification: value,
      }),
    ).toThrow(message);
  });

  it('identifies an invalid QA technical specification', () => {
    expect(() =>
      requestFromDraft('QA', {
        ...emptyPlaygroundDraft(),
        productOwnerSpecification: '{}',
        technicalSpecification: 'false',
      }),
    ).toThrow('Technical specification must be a JSON object.');
  });
});

describe('PlaygroundInputForm', () => {
  it('edits and submits Product Owner input', () => {
    const draft: PlaygroundDraft = {
      ...emptyPlaygroundDraft(),
      projectName: 'Portal',
      objective: 'Track orders',
    };
    const { props } = renderForm({ draft });

    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'Console' } });
    expect(props.onChange).toHaveBeenCalledWith({ ...draft, projectName: 'Console' });
    fireEvent.change(screen.getByLabelText('Objective'), { target: { value: 'Inspect prompts' } });
    expect(props.onChange).toHaveBeenCalledWith({ ...draft, objective: 'Inspect prompts' });
    fireEvent.click(screen.getByRole('button', { name: 'Load example' }));
    expect(props.onLoadExample).toHaveBeenCalledOnce();
    fireEvent.submit(screen.getByRole('button', { name: 'Build prompt preview' }).closest('form')!);
    expect(props.onBuild).toHaveBeenCalledOnce();
  });

  it('renders Developer and QA JSON fields and forwards their edits', () => {
    const developer = renderForm({ agent: 'DEVELOPER', example: exampleFor('DEVELOPER') });
    expect(screen.getByLabelText('Product Owner specification')).toBeVisible();
    expect(screen.queryByLabelText('Technical specification')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Product Owner specification'), {
      target: { value: '{"id":1}' },
    });
    expect(developer.props.onChange).toHaveBeenCalledWith({
      ...emptyPlaygroundDraft(),
      productOwnerSpecification: '{"id":1}',
    });

    cleanup();
    const qa = renderForm({ agent: 'QA', example: exampleFor('QA') });
    fireEvent.change(screen.getByLabelText('Technical specification'), {
      target: { value: '{"runtime":"node"}' },
    });
    expect(qa.props.onChange).toHaveBeenCalledWith({
      ...emptyPlaygroundDraft(),
      technicalSpecification: '{"runtime":"node"}',
    });
  });

  it('shows unavailable, error, and disabled states', () => {
    renderForm({
      disabled: true,
      error: 'Input could not be parsed.',
      example: null,
    });

    expect(screen.getByText(/No safe example is available/)).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent('Input could not be parsed.');
    expect(screen.getByRole('button', { name: 'Load example' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Building preview…' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Building preview…' }).closest('form'),
    ).toHaveAttribute('aria-busy', 'true');
  });
});
