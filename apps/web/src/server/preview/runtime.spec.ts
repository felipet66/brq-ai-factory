import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DatabaseClient } from '@brq/prisma';

import type { PreviewSessionView } from '@/api/preview-contracts';
import type { AuthenticatedPrincipal } from '@/server/auth/contracts';

type MockPersistentStore = Readonly<{
  expire: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
}>;

const mocks = vi.hoisted(() => ({
  applicationOptions: undefined as unknown,
  applicationService: undefined as unknown,
  coordinators: [] as unknown[],
  createApplicationService: vi.fn(),
  createCoordinator: vi.fn(),
  createDockerRunner: vi.fn(),
  createFactoryIntegration: vi.fn(),
  createFilesystemStore: vi.fn(),
  createGatewayService: vi.fn(),
  createPersistentStore: vi.fn(),
  executionRepositories: [] as unknown[],
  filesystemStore: undefined as unknown,
  gatewayOptions: undefined as unknown,
  gatewayService: undefined as unknown,
  persistentStore: undefined as unknown as MockPersistentStore,
  previewRepositories: [] as unknown[],
  runner: undefined as unknown,
}));

vi.mock('@brq/preview-artifact/filesystem', () => ({
  createFilesystemPreviewArtifactStore: mocks.createFilesystemStore,
}));

vi.mock('@brq/execution-repository/prisma', () => ({
  PrismaExecutionRecordRepository: vi.fn(function MockExecutionRepository(
    this: Record<string, unknown>,
    client: unknown,
    access: unknown,
  ) {
    Object.assign(this, { client, access });
    mocks.executionRepositories.push(this);
  }),
}));

vi.mock('@brq/execution-repository/preview-prisma', () => ({
  PrismaPreviewRepository: vi.fn(function MockPreviewRepository(
    this: Record<string, unknown>,
    client: unknown,
    access: unknown,
  ) {
    Object.assign(this, { client, access });
    mocks.previewRepositories.push(this);
  }),
}));

vi.mock('@brq/preview-runner', async (importOriginal) => {
  const original = await importOriginal<typeof import('@brq/preview-runner')>();
  return { ...original, createPreviewSessionCoordinator: mocks.createCoordinator };
});

vi.mock('@brq/preview-runner/docker', () => ({
  createDockerPreviewRunner: mocks.createDockerRunner,
}));

vi.mock('./application-service', () => ({
  createPreviewApplicationService: mocks.createApplicationService,
}));

vi.mock('./artifact-integration', async (importOriginal) => {
  const original = await importOriginal<typeof import('./artifact-integration')>();
  return {
    ...original,
    createFactoryPreviewArtifactIntegration: mocks.createFactoryIntegration,
    createPersistentPreviewArtifactStore: mocks.createPersistentStore,
  };
});

vi.mock('./gateway-service', () => ({
  createPreviewGatewayService: mocks.createGatewayService,
}));

import {
  createApplicationFactoryPreviewArtifactIntegration,
  createApplicationPreviewRuntime,
} from './runtime';

const NOW = Date.parse('2026-08-10T12:00:00.000Z');
const previewId = (character: string) => `preview-${character.repeat(32)}`;
const executionId = `execution-${'e'.repeat(32)}`;
const hash = 'a'.repeat(64);

const environment = Object.freeze({
  BRQ_PREVIEW_MODE: 'DOCKER',
  BRQ_PREVIEW_ORIGIN_TEMPLATE: 'http://{previewId}.preview.localhost:3000',
  BRQ_PREVIEW_COOKIE_SECRET: 's'.repeat(64),
  BRQ_PREVIEW_ARTIFACT_ROOT: '/tmp/brq-preview-runtime-tests',
  BRQ_PREVIEW_DOCKER_EXECUTABLE: '/usr/local/bin/docker',
  BRQ_PREVIEW_DOCKER_HOST: 'unix:///var/run/docker.sock',
  BRQ_PREVIEW_IMAGE_REFERENCE: `brq-preview@sha256:${'a'.repeat(64)}`,
  BRQ_PREVIEW_IMAGE_ID: `sha256:${'b'.repeat(64)}`,
  BRQ_PREVIEW_IMAGE_PLATFORM: 'linux/arm64',
});

function session(
  status: PreviewSessionView['status'] = 'RUNNING',
  id = previewId('1'),
  expiresAt = '2026-08-10T12:00:20.000Z',
): PreviewSessionView {
  return {
    previewId: id,
    executionId,
    status,
    health: status === 'RUNNING' ? 'HEALTHY' : 'NOT_APPLICABLE',
    createdAt: '2026-08-10T12:00:00.000Z',
    startedAt: status === 'RUNNING' ? '2026-08-10T12:00:01.000Z' : null,
    expiresAt,
    stoppedAt: status === 'RUNNING' ? null : '2026-08-10T12:00:10.000Z',
    policy: { id: 'NODE_WEB_PREVIEW_24_V1', version: '1.0.0' },
    hashes: {
      factoryResultHash: hash,
      artifactHash: 'b'.repeat(64),
      previewRequestHash: 'c'.repeat(64),
      previewSessionHash: 'd'.repeat(64),
    },
    controlPath: `/executions/${executionId}/preview`,
    failure: status === 'FAILED' ? { code: 'PREVIEW_RUNTIME_LOST' } : null,
  };
}

function principal(role: 'USER' | 'ADMIN'): AuthenticatedPrincipal {
  return {
    userId: role === 'ADMIN' ? 'admin-1' : 'user-1',
    role,
    user: {
      id: role === 'ADMIN' ? 'admin-1' : 'user-1',
      name: role,
      email: `${role.toLowerCase()}@example.local`,
      role,
      createdAt: '2026-08-10T00:00:00.000Z',
      updatedAt: '2026-08-10T00:00:00.000Z',
    },
  };
}

function client(
  options: {
    readonly artifactQueries?: readonly unknown[][];
    readonly sessionQueries?: readonly unknown[][];
  } = {},
) {
  const artifactFindMany = vi.fn();
  for (const result of options.artifactQueries ?? [[], []]) {
    artifactFindMany.mockResolvedValueOnce(result);
  }
  const sessionFindMany = vi.fn();
  for (const result of options.sessionQueries ?? [[], [], []]) {
    sessionFindMany.mockResolvedValueOnce(result);
  }
  return {
    previewArtifact: { findMany: artifactFindMany },
    previewSession: { findMany: sessionFindMany },
  } as unknown as DatabaseClient;
}

function baseService(overrides: Record<string, unknown> = {}) {
  return {
    getExecutionControl: vi.fn(async () => ({
      eligibility: { status: 'ELIGIBLE' as const },
      session: null,
    })),
    start: vi.fn(async () => session()),
    get: vi.fn(async () => session()),
    stop: vi.fn(async () => session('STOPPED')),
    createLaunch: vi.fn(async () => null),
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  mocks.coordinators.length = 0;
  mocks.executionRepositories.length = 0;
  mocks.previewRepositories.length = 0;
  for (const candidate of [
    mocks.createApplicationService,
    mocks.createCoordinator,
    mocks.createDockerRunner,
    mocks.createFactoryIntegration,
    mocks.createFilesystemStore,
    mocks.createGatewayService,
    mocks.createPersistentStore,
  ]) {
    candidate.mockReset();
  }

  mocks.filesystemStore = Object.freeze({ kind: 'filesystem-store' });
  mocks.persistentStore = {
    expire: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
  };
  mocks.runner = Object.freeze({ resolveGatewayTarget: vi.fn(() => null) });
  mocks.applicationService = baseService();
  mocks.gatewayService = Object.freeze({ redeem: vi.fn(), proxy: vi.fn() });

  mocks.createFilesystemStore.mockReturnValue(mocks.filesystemStore);
  mocks.createPersistentStore.mockReturnValue(mocks.persistentStore);
  mocks.createDockerRunner.mockReturnValue(mocks.runner);
  mocks.createCoordinator.mockImplementation(() => {
    const coordinator = {
      reconcile: vi.fn(async (id: string) => session('RUNNING', id)),
      expire: vi.fn(async (id: string) => session('EXPIRED', id)),
      stop: vi.fn(async (id: string) => session('STOPPED', id)),
    };
    mocks.coordinators.push(coordinator);
    return coordinator;
  });
  mocks.createApplicationService.mockImplementation((options: unknown) => {
    mocks.applicationOptions = options;
    return mocks.applicationService;
  });
  mocks.createGatewayService.mockImplementation((options: unknown) => {
    mocks.gatewayOptions = options;
    return mocks.gatewayService;
  });
  mocks.createFactoryIntegration.mockReturnValue(Object.freeze({ kind: 'factory-integration' }));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Application Preview runtime', () => {
  it('fails before composing adapters when mandatory host configuration is absent', async () => {
    await expect(
      createApplicationPreviewRuntime({ client: client(), environment: {} }),
    ).rejects.toThrow(/configuração Docker/u);
    expect(mocks.createFilesystemStore).not.toHaveBeenCalled();
    expect(mocks.createDockerRunner).not.toHaveBeenCalled();
  });

  it('composes trusted adapters and reconciles artifacts plus active/failed sessions', async () => {
    const expiredArtifactId = `preview-artifact-${'1'.repeat(32)}`;
    const pendingArtifactId = `preview-artifact-${'2'.repeat(32)}`;
    const activeId = previewId('3');
    const failedId = previewId('4');
    const database = client({
      artifactQueries: [
        [{ artifactId: expiredArtifactId }],
        [{ artifactId: pendingArtifactId, expiresAt: new Date(NOW + 10_000) }],
      ],
      sessionQueries: [[{ previewId: activeId }], [{ previewId: failedId }], []],
    });
    vi.mocked(mocks.persistentStore.expire).mockRejectedValueOnce(new Error('already terminal'));

    const runtime = await createApplicationPreviewRuntime({
      client: database,
      environment,
      now: Date.now,
    });
    const globalCoordinator = mocks.coordinators[0] as {
      readonly reconcile: ReturnType<typeof vi.fn>;
      readonly expire: ReturnType<typeof vi.fn>;
    };

    expect(mocks.createFilesystemStore).toHaveBeenCalledWith({
      rootPath: environment.BRQ_PREVIEW_ARTIFACT_ROOT,
    });
    expect(mocks.createDockerRunner).toHaveBeenCalledWith(
      expect.objectContaining({
        dockerExecutable: environment.BRQ_PREVIEW_DOCKER_EXECUTABLE,
        dockerHost: environment.BRQ_PREVIEW_DOCKER_HOST,
        contentStore: mocks.persistentStore,
      }),
    );
    expect(mocks.persistentStore.expire).toHaveBeenCalledWith(
      expiredArtifactId,
      '2026-08-10T12:00:00.000Z',
    );
    expect(mocks.persistentStore.remove).toHaveBeenCalledWith(
      expiredArtifactId,
      '2026-08-10T12:00:00.000Z',
    );
    expect(globalCoordinator.reconcile).toHaveBeenCalledWith(activeId);
    expect(globalCoordinator.reconcile).toHaveBeenCalledWith(failedId);
    expect(runtime.originTemplate).toBe(environment.BRQ_PREVIEW_ORIGIN_TEMPLATE);
    expect(runtime.gatewayService).toBe(mocks.gatewayService);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(mocks.persistentStore.remove).toHaveBeenCalledWith(
      pendingArtifactId,
      '2026-08-10T12:00:10.000Z',
    );
    await vi.advanceTimersByTimeAsync(10_000);
    expect(globalCoordinator.expire).toHaveBeenCalledWith(activeId);
    await runtime.shutdown();
  });

  it('scopes repositories by principal and schedules only live application sessions', async () => {
    const runtime = await createApplicationPreviewRuntime({
      client: client(),
      environment,
      now: Date.now,
    });
    const applicationOptions = mocks.applicationOptions as {
      readonly contextForPrincipal: (value: AuthenticatedPrincipal) => unknown;
    };
    applicationOptions.contextForPrincipal(principal('USER'));
    applicationOptions.contextForPrincipal(principal('ADMIN'));

    expect(mocks.previewRepositories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ access: { access: 'OWNER', userId: 'user-1' } }),
        expect.objectContaining({ access: { access: 'GLOBAL_PREVIEW' } }),
      ]),
    );
    expect(mocks.executionRepositories).toEqual([
      expect.objectContaining({ access: { access: 'OWNER', userId: 'user-1' } }),
      expect.objectContaining({ access: { access: 'GLOBAL_READ_ONLY' } }),
    ]);

    const running = await runtime.applicationService.start(
      executionId,
      principal('USER'),
      {},
      { requestId: 'request-1', signal: new AbortController().signal },
    );
    expect(running.status).toBe('RUNNING');
    await runtime.applicationService.stop(previewId('1'), principal('USER'), {
      requestId: 'request-2',
    });
    await vi.advanceTimersByTimeAsync(30_000);
    const globalCoordinator = mocks.coordinators[0] as {
      readonly expire: ReturnType<typeof vi.fn>;
    };
    expect(globalCoordinator.expire).not.toHaveBeenCalled();

    vi.mocked((mocks.applicationService as ReturnType<typeof baseService>).get)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(session('RUNNING', previewId('5'), '2026-08-10T12:01:00.000Z'));
    expect(await runtime.applicationService.get(previewId('5'), principal('USER'))).toBeNull();
    await runtime.applicationService.get(previewId('5'), principal('USER'));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(globalCoordinator.expire).toHaveBeenCalledWith(previewId('5'));
    expect(
      await runtime.applicationService.getExecutionControl(executionId, principal('USER')),
    ).toMatchObject({ eligibility: { status: 'ELIGIBLE' } });
    expect(
      await runtime.applicationService.createLaunch(previewId('5'), principal('USER'), {
        requestId: 'request-3',
      }),
    ).toBeNull();
    await runtime.shutdown();
  });

  it('does not schedule pre-running sessions and preserves a null stop result', async () => {
    const service = mocks.applicationService as ReturnType<typeof baseService>;
    vi.mocked(service.start).mockResolvedValueOnce(session('CREATED'));
    vi.mocked(service.stop).mockResolvedValueOnce(null as never);
    const runtime = await createApplicationPreviewRuntime({
      client: client(),
      environment,
      now: Date.now,
    });
    const globalCoordinator = mocks.coordinators[0] as {
      readonly expire: ReturnType<typeof vi.fn>;
    };

    expect(
      await runtime.applicationService.start(
        executionId,
        principal('USER'),
        {},
        { requestId: 'request-created', signal: new AbortController().signal },
      ),
    ).toMatchObject({ status: 'CREATED' });
    expect(
      await runtime.applicationService.stop(previewId('1'), principal('USER'), {
        requestId: 'request-null-stop',
      }),
    ).toBeNull();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(globalCoordinator.expire).not.toHaveBeenCalled();
    await runtime.shutdown();
  });

  it('uses host logger and default clock while keeping startup reconciliation best effort', async () => {
    const terminalId = previewId('a');
    const rejectedId = previewId('b');
    const globalCoordinator = {
      reconcile: vi.fn(async (id: string) => {
        if (id === rejectedId) throw new Error('runtime unavailable');
        return session('STOPPED', id);
      }),
      expire: vi.fn(async (id: string) => session('EXPIRED', id)),
      stop: vi.fn(async (id: string) => session('STOPPED', id)),
    };
    mocks.createCoordinator.mockImplementationOnce(() => {
      mocks.coordinators.push(globalCoordinator);
      return globalCoordinator;
    });
    const logger = Object.freeze({ info: vi.fn(), error: vi.fn() });
    const runtime = await createApplicationPreviewRuntime({
      client: client({
        sessionQueries: [[{ previewId: terminalId }], [{ previewId: rejectedId }], []],
      }),
      environment,
      logger: logger as never,
    });

    expect(globalCoordinator.reconcile).toHaveBeenCalledWith(terminalId);
    expect(globalCoordinator.reconcile).toHaveBeenCalledWith(rejectedId);
    expect(mocks.createCoordinator).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ logger, now: Date.now }),
    );

    const applicationOptions = mocks.applicationOptions as {
      readonly contextForPrincipal: (value: AuthenticatedPrincipal) => unknown;
    };
    applicationOptions.contextForPrincipal(principal('ADMIN'));
    expect(mocks.createCoordinator).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ logger, now: Date.now }),
    );

    const target = Object.freeze({ host: '127.0.0.1', port: 30_000 });
    vi.mocked(
      (mocks.runner as { resolveGatewayTarget: ReturnType<typeof vi.fn> }).resolveGatewayTarget,
    ).mockResolvedValueOnce(target);
    const gatewayOptions = mocks.gatewayOptions as {
      readonly locator: { resolveGatewayTarget(request: unknown): Promise<unknown> };
    };
    const request = Object.freeze({ previewId: terminalId });
    await expect(gatewayOptions.locator.resolveGatewayTarget(request)).resolves.toBe(target);
    expect(
      (mocks.runner as { resolveGatewayTarget: ReturnType<typeof vi.fn> }).resolveGatewayTarget,
    ).toHaveBeenCalledWith(request);
    await runtime.shutdown();
  });

  it('contains asynchronous session and artifact expiration failures', async () => {
    const pendingArtifactId = `preview-artifact-${'c'.repeat(32)}`;
    const runtime = await createApplicationPreviewRuntime({
      client: client({
        artifactQueries: [
          [],
          [{ artifactId: pendingArtifactId, expiresAt: new Date(NOW + 10_000) }],
        ],
      }),
      environment,
      now: Date.now,
    });
    const globalCoordinator = mocks.coordinators[0] as {
      readonly expire: ReturnType<typeof vi.fn>;
    };
    globalCoordinator.expire.mockRejectedValueOnce(new Error('container already gone'));
    vi.mocked(mocks.persistentStore.remove).mockRejectedValueOnce(
      new Error('artifact already removed'),
    );

    await runtime.applicationService.start(
      executionId,
      principal('USER'),
      {},
      { requestId: 'request-expire', signal: new AbortController().signal },
    );
    await vi.advanceTimersByTimeAsync(20_000);

    expect(mocks.persistentStore.remove).toHaveBeenCalledWith(
      pendingArtifactId,
      '2026-08-10T12:00:10.000Z',
    );
    expect(globalCoordinator.expire).toHaveBeenCalledWith(previewId('1'));
    await expect(runtime.shutdown()).resolves.toBeUndefined();
  });

  it('stops every bounded active session and clears future session/artifact timers on shutdown', async () => {
    const activeAtStartup = previewId('6');
    const shutdownFirst = previewId('7');
    const shutdownSecond = previewId('8');
    const pendingArtifactId = `preview-artifact-${'9'.repeat(32)}`;
    const database = client({
      artifactQueries: [[], [{ artifactId: pendingArtifactId, expiresAt: new Date(NOW + 60_000) }]],
      sessionQueries: [
        [{ previewId: activeAtStartup }],
        [],
        [{ previewId: shutdownFirst }, { previewId: shutdownSecond }],
      ],
    });
    const runtime = await createApplicationPreviewRuntime({
      client: database,
      environment,
      now: Date.now,
    });
    const globalCoordinator = mocks.coordinators[0] as {
      readonly expire: ReturnType<typeof vi.fn>;
      readonly stop: ReturnType<typeof vi.fn>;
    };
    globalCoordinator.stop
      .mockRejectedValueOnce(new Error('cleanup reported'))
      .mockResolvedValueOnce(session('STOPPED', shutdownSecond));

    await expect(runtime.shutdown()).resolves.toBeUndefined();
    expect(globalCoordinator.stop).toHaveBeenCalledWith(shutdownFirst);
    expect(globalCoordinator.stop).toHaveBeenCalledWith(shutdownSecond);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(globalCoordinator.expire).not.toHaveBeenCalled();
    expect(mocks.persistentStore.remove).not.toHaveBeenCalledWith(
      pendingArtifactId,
      expect.any(String),
    );
  });
});

describe('Factory Preview artifact composition', () => {
  it('uses the independent private artifact root and internal metadata authority', () => {
    const database = client();
    const now = () => NOW;
    const integration = createApplicationFactoryPreviewArtifactIntegration({
      client: database,
      environment,
      sandboxPolicyId: 'NODE_WEB_PREVIEW_24_V1',
      now,
    });

    expect(integration).toEqual({ kind: 'factory-integration' });
    expect(mocks.createFilesystemStore).toHaveBeenCalledWith({
      rootPath: environment.BRQ_PREVIEW_ARTIFACT_ROOT,
    });
    expect(mocks.previewRepositories.at(-1)).toEqual(
      expect.objectContaining({ access: { access: 'INTERNAL' } }),
    );
    expect(mocks.createFactoryIntegration).toHaveBeenCalledWith(
      expect.objectContaining({
        store: mocks.filesystemStore,
        sandboxPolicyId: 'NODE_WEB_PREVIEW_24_V1',
        now,
      }),
    );
  });

  it('fails closed before composing storage when the artifact root is absent', () => {
    expect(() =>
      createApplicationFactoryPreviewArtifactIntegration({
        client: client(),
        environment: {},
        sandboxPolicyId: 'NODE_WEB_PREVIEW_24_V1',
      }),
    ).toThrow(/raiz explícita/u);
    expect(mocks.createFactoryIntegration).not.toHaveBeenCalled();
  });

  it('leaves the clock override absent when the host does not provide one', () => {
    createApplicationFactoryPreviewArtifactIntegration({
      client: client(),
      environment,
      sandboxPolicyId: 'NODE_WEB_PREVIEW_24_V1',
    });

    expect(mocks.createFactoryIntegration).toHaveBeenCalledWith(
      expect.not.objectContaining({ now: expect.anything() }),
    );
  });
});
