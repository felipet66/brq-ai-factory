'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

import {
  PlaygroundClientError,
  buildPlaygroundPreview,
  getPlaygroundAgents,
  validatePlaygroundCandidate,
} from '@/api/playground-client';
import type {
  PlaygroundAgent,
  PlaygroundCatalog,
  PlaygroundPipelineStage,
  PlaygroundPreview,
  PlaygroundPreviewRequest,
  PlaygroundValidation,
  PlaygroundValidationRequest,
} from '@/api/playground-contracts';

import { AccessibleTabs, tabId, tabPanelId } from './accessible-tabs';
import { AgentSelector } from './agent-selector';
import { BudgetMeter } from './budget-meter';
import { HashInspector } from './hash-inspector';
import { KnowledgeInspector } from './knowledge-inspector';
import { OutputContractInspector } from './output-contract-inspector';
import { PipelineNodeDetails, PipelineVisualization } from './pipeline-visualization';
import {
  draftFromExample,
  emptyPlaygroundDraft,
  PlaygroundInputForm,
  requestFromDraft,
  type PlaygroundDraft,
} from './playground-input-form';
import {
  PlaygroundErrorState,
  PlaygroundLoadingState,
  EmptyInspectorState,
} from './playground-state';
import { PromptPreview } from './prompt-preview';
import styles from './playground.module.css';
import { TrustBoundaries } from './trust-boundaries';
import { ValidationWorkspace } from './validation-pipeline';

type InspectorTab = 'OVERVIEW' | 'PROMPT' | 'CONTRACT' | 'KNOWLEDGE' | 'HASHES' | 'VALIDATION';
const INSPECTOR_TABS = [
  { id: 'OVERVIEW', label: 'Overview' },
  { id: 'PROMPT', label: 'Prompt' },
  { id: 'CONTRACT', label: 'Contract' },
  { id: 'KNOWLEDGE', label: 'Knowledge' },
  { id: 'HASHES', label: 'Hashes' },
  { id: 'VALIDATION', label: 'Validation' },
] as const;

type CatalogState =
  | { readonly status: 'loading' }
  | { readonly status: 'success'; readonly catalog: PlaygroundCatalog }
  | { readonly status: 'error'; readonly message: string };

const FALLBACK_ERROR = 'The Playground service could not process this request.';

function safeErrorMessage(error: unknown): string {
  if (!(error instanceof PlaygroundClientError)) return FALLBACK_ERROR;
  const message = error.message.trim();
  return message.length > 0 && message.length <= 300 ? message : FALLBACK_ERROR;
}

function validationRequest(
  request: PlaygroundPreviewRequest,
  content: string,
): PlaygroundValidationRequest {
  if (request.agent === 'PRODUCT_OWNER') {
    return { ...request, candidate: { content } };
  }
  if (request.agent === 'DEVELOPER') {
    return { ...request, candidate: { content } };
  }
  return { ...request, candidate: { content } };
}

export function PlaygroundExperience() {
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const [catalogState, setCatalogState] = useState<CatalogState>({ status: 'loading' });
  const [agent, setAgent] = useState<PlaygroundAgent>('PRODUCT_OWNER');
  const [draft, setDraft] = useState<PlaygroundDraft>(emptyPlaygroundDraft);
  const [inputError, setInputError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PlaygroundPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [validation, setValidation] = useState<PlaygroundValidation | null>(null);
  const [validationLoading, setValidationLoading] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [selectedStage, setSelectedStage] = useState<PlaygroundPipelineStage>('KNOWLEDGE');
  const [activeTab, setActiveTab] = useState<InspectorTab>('OVERVIEW');
  const previewController = useRef<AbortController | null>(null);
  const validationController = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void getPlaygroundAgents({ signal: controller.signal }).then(
      (catalog) => {
        setCatalogState({ status: 'success', catalog });
        const initial = catalog.agents[0];
        if (initial !== undefined) setAgent(initial.agent);
      },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setCatalogState({ status: 'error', message: safeErrorMessage(error) });
        }
      },
    );
    return () => controller.abort();
  }, [catalogAttempt]);

  useEffect(
    () => () => {
      previewController.current?.abort();
      validationController.current?.abort();
    },
    [],
  );

  if (catalogState.status === 'loading') {
    return (
      <PlaygroundShell>
        <PlaygroundLoadingState />
      </PlaygroundShell>
    );
  }
  if (catalogState.status === 'error') {
    return (
      <PlaygroundShell>
        <PlaygroundErrorState
          message={catalogState.message}
          onRetry={() => {
            setCatalogState({ status: 'loading' });
            setCatalogAttempt((attempt) => attempt + 1);
          }}
        />
      </PlaygroundShell>
    );
  }

  const { catalog } = catalogState;
  const descriptor =
    catalog.agents.find((candidate) => candidate.agent === agent) ?? catalog.agents[0];
  if (descriptor === undefined) {
    return (
      <PlaygroundShell>
        <PlaygroundErrorState message="No inspectable agents are available." />
      </PlaygroundShell>
    );
  }
  const example = descriptor.examples[0] ?? null;
  const pipeline = preview?.pipeline ?? catalog.pipeline;
  const selectedNode = pipeline.find((node) => node.stage === selectedStage) ?? pipeline[0]!;
  const builtPreview = preview?.status === 'BUILT' ? preview : null;
  const busy = previewLoading || validationLoading;

  function resetInspection(): void {
    previewController.current?.abort();
    validationController.current?.abort();
    previewController.current = null;
    validationController.current = null;
    setPreviewLoading(false);
    setValidationLoading(false);
    setPreview(null);
    setPreviewError(null);
    setValidation(null);
    setValidationError(null);
    setInputError(null);
    setSelectedStage('KNOWLEDGE');
    setActiveTab('OVERVIEW');
  }

  function changeAgent(nextAgent: PlaygroundAgent): void {
    resetInspection();
    setAgent(nextAgent);
    setDraft(emptyPlaygroundDraft());
  }

  function loadExample(): void {
    if (example === null) return;
    resetInspection();
    setDraft(draftFromExample(agent, example));
  }

  function readRequest(): PlaygroundPreviewRequest | null {
    try {
      const request = requestFromDraft(agent, draft);
      setInputError(null);
      return request;
    } catch (error) {
      setInputError(error instanceof Error ? error.message : 'The agent input is invalid.');
      return null;
    }
  }

  function buildPreview(): void {
    const request = readRequest();
    if (request === null) return;

    previewController.current?.abort();
    const controller = new AbortController();
    previewController.current = controller;
    setPreviewLoading(true);
    setPreviewError(null);
    setValidation(null);
    setValidationError(null);
    void buildPlaygroundPreview(request, { signal: controller.signal })
      .then(
        (result) => {
          if (controller.signal.aborted) return;
          setPreview(result);
          setSelectedStage(result.status === 'REJECTED' ? result.error.stage : 'KNOWLEDGE');
          setActiveTab('OVERVIEW');
        },
        (error: unknown) => {
          if (!controller.signal.aborted) setPreviewError(safeErrorMessage(error));
        },
      )
      .finally(() => {
        if (previewController.current === controller) {
          previewController.current = null;
          setPreviewLoading(false);
        }
      });
  }

  function validateCandidate(): void {
    const request = readRequest();
    if (request === null) return;

    validationController.current?.abort();
    const controller = new AbortController();
    validationController.current = controller;
    setValidationLoading(true);
    setValidationError(null);
    void validatePlaygroundCandidate(validationRequest(request, draft.candidate), {
      signal: controller.signal,
    })
      .then(
        (result) => {
          if (!controller.signal.aborted) setValidation(result);
        },
        (error: unknown) => {
          if (!controller.signal.aborted) setValidationError(safeErrorMessage(error));
        },
      )
      .finally(() => {
        if (validationController.current === controller) {
          validationController.current = null;
          setValidationLoading(false);
        }
      });
  }

  const announcement = previewLoading
    ? 'Building prompt preview.'
    : validationLoading
      ? 'Validating candidate response.'
      : preview?.status === 'BUILT'
        ? 'Prompt preview built.'
        : preview?.status === 'REJECTED'
          ? `Prompt preview rejected at ${preview.error.stage}.`
          : validation === null
            ? 'Prompt Playground ready.'
            : `Validation ${validation.status.toLowerCase()}.`;

  return (
    <PlaygroundShell>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
      <div className={styles.workbench}>
        <aside className={styles.controlRail} aria-label="Playground controls">
          <AgentSelector
            agents={catalog.agents}
            disabled={false}
            onChange={changeAgent}
            value={agent}
          />
          <PlaygroundInputForm
            agent={agent}
            disabled={busy}
            draft={draft}
            error={inputError}
            example={example}
            onBuild={buildPreview}
            onChange={(next) => {
              setDraft(next);
              if (inputError !== null) setInputError(null);
            }}
            onLoadExample={loadExample}
          />
        </aside>

        <section className={styles.inspector} aria-label="Prompt inspector" aria-busy={busy}>
          <PipelineVisualization
            nodes={pipeline}
            onSelect={setSelectedStage}
            selected={selectedStage}
          />
          <PipelineNodeDetails node={selectedNode} />

          {previewError === null ? null : <PlaygroundErrorState message={previewError} />}
          {preview?.status === 'REJECTED' ? (
            <div className={`${styles.fullState} ${styles.errorState}`} role="alert">
              <div>
                <strong>{preview.error.code}</strong>
                <p>{preview.error.message}</p>
              </div>
            </div>
          ) : null}

          <div className={styles.inspectorTabs}>
            <AccessibleTabs
              activeTab={activeTab}
              ariaLabel="Prompt inspector views"
              idPrefix="playground-inspector"
              onChange={setActiveTab}
              tabs={INSPECTOR_TABS}
            />
          </div>
          <div
            id={tabPanelId('playground-inspector', activeTab)}
            className={styles.inspectorTabPanel}
            role="tabpanel"
            aria-labelledby={tabId('playground-inspector', activeTab)}
            tabIndex={0}
          >
            {activeTab === 'VALIDATION' ? (
              <ValidationWorkspace
                disabled={validationLoading}
                draft={draft}
                error={validationError}
                onChange={setDraft}
                onValidate={validateCandidate}
                result={validation}
              />
            ) : builtPreview === null ? (
              <EmptyInspectorState
                title={`${activeTab.charAt(0)}${activeTab.slice(1).toLowerCase()} is idle`}
              />
            ) : activeTab === 'OVERVIEW' ? (
              <div className={styles.overviewGrid}>
                <section className={styles.contentPanel} aria-labelledby="build-overview-heading">
                  <div className={styles.sectionHeading}>
                    <div>
                      <p className={styles.kicker}>Resolved build</p>
                      <h2 id="build-overview-heading">{descriptor.label} overview</h2>
                    </div>
                    <span>{builtPreview.status}</span>
                  </div>
                  <dl className={styles.contractFacts}>
                    <div>
                      <dt>Agent version</dt>
                      <dd>{builtPreview.versions.agentVersion}</dd>
                    </div>
                    <div>
                      <dt>Prompt version</dt>
                      <dd>{builtPreview.versions.promptVersion}</dd>
                    </div>
                    <div>
                      <dt>Schema version</dt>
                      <dd>{builtPreview.versions.promptSchemaVersion}</dd>
                    </div>
                    <div>
                      <dt>Sections</dt>
                      <dd>{builtPreview.sections.length}</dd>
                    </div>
                  </dl>
                </section>
                <BudgetMeter budget={builtPreview.budget} />
                <TrustBoundaries
                  boundaries={builtPreview.trustBoundaries}
                  sections={builtPreview.sections}
                />
              </div>
            ) : activeTab === 'PROMPT' ? (
              <PromptPreview prompt={builtPreview.prompt} />
            ) : activeTab === 'CONTRACT' ? (
              <OutputContractInspector contract={builtPreview.outputContract} />
            ) : activeTab === 'KNOWLEDGE' ? (
              <KnowledgeInspector knowledge={builtPreview.knowledge} />
            ) : (
              <HashInspector hashes={builtPreview.hashes} />
            )}
          </div>
        </section>
      </div>
    </PlaygroundShell>
  );
}

function PlaygroundShell({ children }: { readonly children: ReactNode }) {
  return (
    <main className={styles.shell} lang="en">
      <div className={styles.layout}>
        <header className={styles.hero}>
          <div>
            <p className={styles.kicker}>Agent engineering control room</p>
            <h1>Prompt Playground</h1>
          </div>
          <p>
            Inspect how Product Owner, Developer and QA prompts are assembled, bounded and validated
            without invoking an AI provider.
          </p>
        </header>
        <aside className={styles.ephemeralBanner} aria-label="Inspection data retention">
          <span aria-hidden="true">●</span>
          <div>
            <strong>Ephemeral inspection</strong>
            <p>Inspection data is ephemeral and is not persisted.</p>
          </div>
        </aside>
        {children}
      </div>
    </main>
  );
}
