import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildPlaygroundPreview,
  getPlaygroundAgents,
  PlaygroundClientError,
  validatePlaygroundCandidate,
} from '@/api/playground-client';
import type {
  PlaygroundBuiltPreview,
  PlaygroundCatalog,
  PlaygroundPreview,
  PlaygroundValidation,
} from '@/api/playground-contracts';

import { PlaygroundExperience } from './playground-experience';
import {
  builtPreviewFixture,
  playgroundCatalogFixture,
  validationFixture,
} from './playground.spec.fixtures';

vi.mock('@/api/playground-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/playground-client')>();
  return {
    ...actual,
    buildPlaygroundPreview: vi.fn(),
    getPlaygroundAgents: vi.fn(),
    validatePlaygroundCandidate: vi.fn(),
  };
});

const catalogMock = vi.mocked(getPlaygroundAgents);
const buildMock = vi.mocked(buildPlaygroundPreview);
const validateMock = vi.mocked(validatePlaygroundCandidate);

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

async function loadCatalog(): Promise<void> {
  await screen.findByRole('radio', { name: /Product Owner/i });
}

async function loadProductOwnerExample(): Promise<void> {
  await loadCatalog();
  fireEvent.click(screen.getByRole('button', { name: 'Load example' }));
}

describe('PlaygroundExperience', { timeout: 15_000 }, () => {
  beforeEach(() => {
    catalogMock.mockReset();
    buildMock.mockReset();
    validateMock.mockReset();
    catalogMock.mockResolvedValue(playgroundCatalogFixture());
    buildMock.mockImplementation(async (request) => builtPreviewFixture(request.agent));
    validateMock.mockResolvedValue(validationFixture());
  });

  afterEach(cleanup);

  it('shows loading before the catalog and identifies inspection as ephemeral', async () => {
    const pending = deferred<ReturnType<typeof playgroundCatalogFixture>>();
    catalogMock.mockReturnValueOnce(pending.promise);
    render(<PlaygroundExperience />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading inspection catalog');
    expect(catalogMock).toHaveBeenCalledWith({ signal: expect.any(AbortSignal) });

    await act(async () => pending.resolve(playgroundCatalogFixture()));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Prompt Playground' }),
    ).toBeVisible();
    expect(screen.getByLabelText('Inspection data retention')).toHaveTextContent(
      'Inspection data is ephemeral and is not persisted.',
    );
    expect(screen.getAllByRole('radio')).toHaveLength(3);
  });

  it('builds a preview and exposes every server-projected inspector without executing markup', async () => {
    render(<PlaygroundExperience />);
    await loadProductOwnerExample();

    expect(screen.getByLabelText('Project name')).toHaveValue('Customer Portal');
    expect(screen.getByLabelText('Objective')).toHaveValue('Track customer orders.');
    fireEvent.click(screen.getByRole('button', { name: 'Build prompt preview' }));

    await waitFor(() => expect(buildMock).toHaveBeenCalledOnce());
    expect(buildMock).toHaveBeenCalledWith(
      {
        agent: 'PRODUCT_OWNER',
        input: { projectName: 'Customer Portal', objective: 'Track customer orders.' },
      },
      { signal: expect.any(AbortSignal) },
    );
    expect(await screen.findByRole('heading', { name: 'Product Owner overview' })).toBeVisible();
    expect(screen.getByRole('progressbar', { name: 'Prompt budget usage' })).toHaveAttribute(
      'value',
      '2048',
    );
    expect(screen.getByRole('heading', { name: 'Trust boundaries' })).toBeVisible();
    expect(screen.getByText('GLOBAL_RULES')).toBeVisible();
    expect(screen.getByText('USER_INPUT')).toBeVisible();

    const rulesNode = screen.getByRole('button', { name: /RULES\s*Valid/i });
    fireEvent.click(rulesNode);
    expect(screen.getByRole('heading', { name: 'RULES' })).toBeVisible();
    expect(screen.getByText('RULES resolved safely.')).toBeVisible();

    const overviewTab = screen.getByRole('tab', { name: 'Overview' });
    overviewTab.focus();
    fireEvent.keyDown(overviewTab, { key: 'ArrowRight' });
    const promptTab = screen.getByRole('tab', { name: 'Prompt' });
    expect(promptTab).toHaveAttribute('aria-selected', 'true');
    expect(promptTab).toHaveFocus();
    expect(screen.getByText(/Never execute markup:/)).toBeVisible();
    expect(document.querySelector('img')).toBeNull();

    const instructionsTab = screen.getByRole('tab', { name: 'Instructions' });
    fireEvent.keyDown(instructionsTab, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Input' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('{"objective":"Track orders"}')).toBeVisible();

    fireEvent.click(screen.getByRole('tab', { name: 'Contract' }));
    expect(screen.getByRole('heading', { name: 'Output contract' })).toBeVisible();
    expect(screen.getByLabelText('Schema summary')).toHaveTextContent(/Properties\s*1/);
    expect(screen.getByText('Constraints: additionalProperties=false')).toBeVisible();

    fireEvent.click(screen.getByRole('tab', { name: 'Knowledge' }));
    expect(screen.getByRole('cell', { name: 'knowledge-security' })).toBeVisible();
    expect(screen.getByRole('cell', { name: 'REQUIRED' })).toBeVisible();
    expect(screen.queryByText('Trusted instruction.')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Hashes' }));
    expect(screen.getByRole('heading', { name: 'Hash inspector' })).toBeVisible();
    expect(screen.getByText('Server generated')).toBeVisible();
  });

  it('builds Product Owner, Developer and QA inputs from catalog examples', async () => {
    render(<PlaygroundExperience />);
    await loadProductOwnerExample();

    fireEvent.click(screen.getByRole('button', { name: 'Build prompt preview' }));
    await waitFor(() => expect(buildMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('radio', { name: /Developer/i }));
    expect(screen.getByText('Overview is idle')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Load example' }));
    fireEvent.click(screen.getByRole('button', { name: 'Build prompt preview' }));
    await waitFor(() => expect(buildMock).toHaveBeenCalledTimes(2));
    expect(buildMock.mock.calls[1]?.[0]).toEqual({
      agent: 'DEVELOPER',
      input: { productOwnerSpecification: { title: 'Order tracking' } },
    });

    fireEvent.click(screen.getByRole('radio', { name: /^QA/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Load example' }));
    fireEvent.click(screen.getByRole('button', { name: 'Build prompt preview' }));
    await waitFor(() => expect(buildMock).toHaveBeenCalledTimes(3));
    expect(buildMock.mock.calls[2]?.[0]).toEqual({
      agent: 'QA',
      input: {
        productOwnerSpecification: { title: 'Order tracking' },
        technicalSpecification: { architecture: 'modular' },
      },
    });
  });

  it('runs manual validation independently and renders sanitized stage issues', async () => {
    validateMock
      .mockResolvedValueOnce(validationFixture('FAIL'))
      .mockResolvedValueOnce(validationFixture());
    render(<PlaygroundExperience />);
    await loadProductOwnerExample();
    fireEvent.click(screen.getByRole('tab', { name: 'Validation' }));

    fireEvent.click(screen.getByRole('button', { name: 'Validate candidate' }));
    await waitFor(() => expect(validateMock).toHaveBeenCalledOnce());
    expect(validateMock).toHaveBeenCalledWith(
      {
        agent: 'PRODUCT_OWNER',
        input: { projectName: 'Customer Portal', objective: 'Track customer orders.' },
        candidate: { content: '{"title":"Order tracking"}' },
      },
      { signal: expect.any(AbortSignal) },
    );
    expect(await screen.findByText('/items/0')).toBeVisible();
    expect(screen.getByText('Keyword: type')).toBeVisible();
    expect(screen.getByText('Expected an object.')).toBeVisible();
    expect(screen.getByText('Contract hash')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Validate candidate' }));
    await waitFor(() => expect(validateMock).toHaveBeenCalledTimes(2));
    expect(screen.getAllByText('PASS').length).toBeGreaterThanOrEqual(5);
  });

  it('aborts an in-flight preview and clears derived state when the agent changes', async () => {
    const pending = deferred<PlaygroundBuiltPreview>();
    let signal: AbortSignal | undefined;
    buildMock.mockImplementationOnce((_request, options) => {
      signal = options?.signal;
      return pending.promise;
    });
    render(<PlaygroundExperience />);
    await loadProductOwnerExample();
    fireEvent.click(screen.getByRole('button', { name: 'Build prompt preview' }));
    await waitFor(() => expect(signal).toBeDefined());
    expect(signal?.aborted).toBe(false);

    fireEvent.click(screen.getByRole('radio', { name: /Developer/i }));

    expect(signal?.aborted).toBe(true);
    expect(screen.getByText('Overview is idle')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Build prompt preview' })).toBeEnabled();
    await act(async () => pending.resolve(builtPreviewFixture()));
    expect(
      screen.queryByRole('heading', { name: 'Product Owner overview' }),
    ).not.toBeInTheDocument();
  });

  it('renders retryable catalog errors and sanitizes unexpected preview failures', async () => {
    catalogMock.mockRejectedValueOnce(
      new PlaygroundClientError('The catalog is temporarily unavailable.', {
        code: 'NETWORK_ERROR',
      }),
    );
    render(<PlaygroundExperience />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The catalog is temporarily unavailable.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await loadProductOwnerExample();

    buildMock.mockRejectedValueOnce(new Error('database password leaked internally'));
    fireEvent.click(screen.getByRole('button', { name: 'Build prompt preview' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The Playground service could not process this request.');
    expect(alert).not.toHaveTextContent('database password');
  });

  it('aborts catalog loading when unmounted', () => {
    const pending = deferred<ReturnType<typeof playgroundCatalogFixture>>();
    let signal: AbortSignal | undefined;
    catalogMock.mockImplementationOnce((options) => {
      signal = options?.signal;
      return pending.promise;
    });

    const { unmount } = render(<PlaygroundExperience />);
    expect(signal?.aborted).toBe(false);
    unmount();
    expect(signal?.aborted).toBe(true);
    pending.resolve(playgroundCatalogFixture());
  });

  it('renders a rejected preview at its failed stage without exposing built inspectors', async () => {
    const built = builtPreviewFixture();
    const rejected: PlaygroundPreview = {
      status: 'REJECTED',
      agent: 'PRODUCT_OWNER',
      retention: 'EPHEMERAL',
      pipeline: built.pipeline.map((node) =>
        node.stage === 'BUDGET'
          ? { ...node, status: 'ERROR', detail: 'Prompt exceeds the configured budget.' }
          : node,
      ),
      error: {
        code: 'PROMPT_BUDGET_EXCEEDED',
        stage: 'BUDGET',
        message: 'The prompt could not be built within its byte budget.',
      },
    };
    buildMock.mockResolvedValueOnce(rejected);
    render(<PlaygroundExperience />);
    await loadProductOwnerExample();

    fireEvent.click(screen.getByRole('button', { name: 'Build prompt preview' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('PROMPT_BUDGET_EXCEEDED');
    expect(alert).toHaveTextContent('The prompt could not be built within its byte budget.');
    expect(screen.getByRole('heading', { name: 'BUDGET' })).toBeVisible();
    expect(screen.getByText('Prompt preview rejected at BUDGET.')).toBeInTheDocument();
    expect(screen.getByText('Overview is idle')).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Prompt budget' })).not.toBeInTheDocument();
  });

  it('keeps invalid draft errors local and clears them as the user edits', async () => {
    render(<PlaygroundExperience />);
    await loadCatalog();

    fireEvent.click(screen.getByRole('button', { name: 'Build prompt preview' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Project name and objective are required.');
    expect(buildMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'Portal' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'Portal v2' } });
    fireEvent.change(screen.getByLabelText('Objective'), { target: { value: 'Track orders.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Build prompt preview' }));
    await waitFor(() => expect(buildMock).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole('radio', { name: /Developer/i }));
    fireEvent.change(screen.getByLabelText('Product Owner specification'), {
      target: { value: '{invalid' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Build prompt preview' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Product Owner specification must contain valid JSON.',
    );
    expect(buildMock).toHaveBeenCalledOnce();
  });

  it('supports manual validation requests for Developer and QA examples', async () => {
    render(<PlaygroundExperience />);
    await loadCatalog();

    fireEvent.click(screen.getByRole('radio', { name: /Developer/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Load example' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Validation' }));
    fireEvent.click(screen.getByRole('button', { name: 'Validate candidate' }));
    await waitFor(() => expect(validateMock).toHaveBeenCalledTimes(1));
    expect(validateMock.mock.calls[0]?.[0]).toEqual({
      agent: 'DEVELOPER',
      input: { productOwnerSpecification: { title: 'Order tracking' } },
      candidate: { content: '{"architecture":"modular"}' },
    });

    fireEvent.click(screen.getByRole('radio', { name: /^QA/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Load example' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Validation' }));
    fireEvent.click(screen.getByRole('button', { name: 'Validate candidate' }));
    await waitFor(() => expect(validateMock).toHaveBeenCalledTimes(2));
    expect(validateMock.mock.calls[1]?.[0]).toEqual({
      agent: 'QA',
      input: {
        productOwnerSpecification: { title: 'Order tracking' },
        technicalSpecification: { architecture: 'modular' },
      },
      candidate: { content: '{"strategy":"risk based"}' },
    });
  });

  it('shows validation loading and sanitized errors, then aborts stale validation on agent change', async () => {
    validateMock.mockRejectedValueOnce(
      new PlaygroundClientError(' '.repeat(4), { code: 'API_ERROR' }),
    );
    render(<PlaygroundExperience />);
    await loadProductOwnerExample();
    fireEvent.click(screen.getByRole('tab', { name: 'Validation' }));
    fireEvent.click(screen.getByRole('button', { name: 'Validate candidate' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The Playground service could not process this request.',
    );

    const pending = deferred<PlaygroundValidation>();
    let signal: AbortSignal | undefined;
    validateMock.mockImplementationOnce((_request, options) => {
      signal = options?.signal;
      return pending.promise;
    });
    fireEvent.click(screen.getByRole('button', { name: 'Validate candidate' }));
    await waitFor(() => expect(signal).toBeDefined());
    expect(screen.getByRole('status')).toHaveTextContent('Validating candidate response.');

    fireEvent.click(screen.getByRole('radio', { name: /Developer/i }));
    expect(signal?.aborted).toBe(true);
    expect(screen.getByText('Overview is idle')).toBeVisible();
    await act(async () => pending.resolve(validationFixture()));
    expect(screen.queryByText('Candidate hash')).not.toBeInTheDocument();
  });

  it('uses fallback errors for oversized client messages and ignores catalog rejection after abort', async () => {
    catalogMock.mockRejectedValueOnce(
      new PlaygroundClientError('x'.repeat(301), { code: 'API_ERROR' }),
    );
    const first = render(<PlaygroundExperience />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The Playground service could not process this request.',
    );
    first.unmount();

    const pending = deferred<PlaygroundCatalog>();
    catalogMock.mockReturnValueOnce(pending.promise);
    const second = render(<PlaygroundExperience />);
    second.unmount();
    await act(async () => pending.reject(new Error('ignored after abort')));
  });

  it('renders honest unavailable-agent and no-example states from catalog projection', async () => {
    const catalog = playgroundCatalogFixture();
    catalogMock.mockResolvedValueOnce({ ...catalog, agents: [] } as PlaygroundCatalog);
    const empty = render(<PlaygroundExperience />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No inspectable agents are available.',
    );
    empty.unmount();

    catalogMock.mockResolvedValueOnce({
      ...catalog,
      agents: [{ ...catalog.agents[0]!, examples: [] }],
    });
    render(<PlaygroundExperience />);
    await loadCatalog();
    expect(screen.getByText(/No safe example is available for this agent\./)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Load example' })).toBeDisabled();
  });
});
