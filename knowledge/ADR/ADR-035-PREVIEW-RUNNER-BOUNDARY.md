# ADR-035 — Preview Runner Boundary

## Status

Accepted

## Date

2026-08-10

## Context

ADR-032 separates generated code from controlled materialization, ADR-033 grants a disposable
Sandbox authority for fixed build and test steps, and ADR-034 coordinates those authorities while
requiring confirmed workspace and container cleanup before Factory `SUCCESS`. Consequently, a
successful execution proves that the generated project passed `PREPARE`, `TYPECHECK`, `BUILD`, and
`TEST`, but intentionally retains neither its Controlled Workspace nor its build output.

Serving generated software introduces a different authority and threat model. It requires a
longer-lived process, an HTTP boundary, browser isolation, ownership enforcement, TTL, and cleanup.
Reusing the build container, retaining the Controlled Workspace, serving untrusted content on the
Factory origin, or allowing generated package scripts to choose a start command would collapse
boundaries already accepted by ADR-032 through ADR-034.

## Decision

Create two independent provider-neutral workspaces:

- `@brq/preview-artifact` validates, hashes, stages, approves, reads, consumes, expires, and removes
  a bounded static Preview Artifact;
- `@brq/preview-runner` owns the Preview lifecycle and exposes a replaceable `PreviewRunner` port.

The application host composes concrete filesystem, Prisma, Docker, authentication, authorization,
ticket, cookie, and reverse-proxy adapters. Core modules do not import Next.js, Better Auth, Prisma,
HTTP, Docker-specific host configuration, agents, prompts, or Factory internals.

The separation is permanent:

```text
generate code != materialize code != build/test != preview != deploy
```

Preview is explicit. It never starts automatically after a Factory execution.

## Safe artifact handoff

The approved approach is export, not workspace retention or reconstruction. A host-owned helper in
the strict Factory image exports a canonical static artifact only after `TEST` succeeds and before
the Sandbox container is removed. Export is an additive, bounded adapter capability; it cannot
change the authoritative Sandbox outcome or its public result.

The host stages the candidate in an ephemeral content store. Only the outer Factory boundary can
approve it after receiving a correlated `FactoryExecutionResult SUCCESS`. Approval verifies the
execution, exact profile, workspace hash, Sandbox request/result hashes, Factory result hash,
content hashes, counts, and limits. Candidates from failed, cancelled, mismatched, or incomplete
Factory runs are removed. The Controlled Workspace and build container still follow their normal
release and cleanup lifecycle.

The initial artifact profile is exactly `NODE_WEB_PREVIEW_24_V1`. It requires a safe canonical
`index.html`, allows only the bounded media types and paths declared by the profile, rejects secret
names, traversal, symlinks, external active resources, unsafe browser APIs, malformed UTF-8,
tampering, excess files, and excess bytes, and fails closed for every other profile. No public
request can select or relax that profile.

Artifact content is ephemeral and content-addressed. The filesystem adapter uses a specific
host-controlled root, restrictive permissions, atomic staging/rename, no symlink following, and a
complete integrity recheck on read. Prisma persists descriptors and hashes only, never file
content or physical paths.

## Preview lifecycle

The state machine is:

```text
CREATED -> STARTING -> RUNNING -> STOPPING -> STOPPED
                           \
                            -> STOPPING -> EXPIRED
CREATED | STARTING | RUNNING | STOPPING -> FAILED
```

`RUNNING` is emitted only after the separate runtime starts and a host-controlled HTTP health
probe succeeds. Stop is idempotent. Manual stop, cancellation, expiration, startup failure, crash,
or reconciliation all converge on bounded cleanup. Cleanup owns container and private network
removal exactly once. No retry, restart, self-healing, or alternate runtime exists.

TTL is host-controlled. A request may only reduce an approved ceiling. The initial default is a
short-lived session and never an indefinite environment. On access, the host reconciles expired or
lost sessions; a bounded in-process expiration mechanism may request the same idempotent stop path.
After process restart, persisted metadata is reconciled against runtime evidence without declaring
a session live from database state alone.

## Docker adapter and strict policy

The first adapter is a separate `DockerPreviewRunner` and separate image/profile. It never reuses
the Sandbox build container. The host selects a digest-pinned, preloaded image whose ID, platform,
labels, Node 24.19.0 runtime, and helper ABI are verified before use. There is no image pull, build,
or fallback at runtime.

The fixed policy owns executable, arguments, internal port, health path, environment, TTL, timeouts,
and resource limits. Generated code and HTTP requests cannot select image, command, package script,
arguments, environment, port, network, mount, device, or limit increase. The adapter never invokes
`npm start`, `npm run dev`, dependency installation, or lifecycle scripts.

Each Preview uses a new non-root, read-only, capability-free container with `no-new-privileges`,
bounded CPU, memory, PIDs, file descriptors, tmpfs, response size, logs, and deadlines. It has no
privileged mode, host network, Docker socket, host filesystem mount, host secret, inherited host
environment, restart policy, or external egress. A private internal Docker network and a
loopback-only host relay make the runtime reachable only through the trusted host gateway. Docker
publishes no container port: the relay invokes a fixed, shell-free helper through `docker exec`, and
that helper can reach only `127.0.0.1:8080` inside the verified container. Container identity and
the ephemeral relay port/token remain private, in-memory adapter details. The relay rejects any
request that does not present its per-runtime capability before invoking Docker.

## HTTP and browser isolation

Preview content is untrusted and is never inserted into the Factory DOM. `View Build` opens a new
top-level browsing context on a unique Preview origin derived from the opaque `previewId`, such as
`https://{previewId}.preview.example`. Local development may use `.localhost` over HTTP; non-local
HTTP origins fail closed.

The Factory origin creates a short-lived, single-use launch ticket only after authentication and
ownership checks. A trusted, nonce-protected auto-submit page posts that ticket to the Preview
origin. Redemption atomically consumes the ticket and creates a host-only, HttpOnly, SameSite
Preview cookie signed with a dedicated secret. Factory cookies, local storage, and DOM are never
shared with the Preview origin.

The application reverse proxy validates the external Host against the configured origin template,
validates the signed Preview cookie and current `RUNNING` session on every request, and resolves a
private loopback target from the trusted runtime adapter. Direct access through the Factory host is
rejected. Only bounded `GET` and `HEAD` requests are supported. WebSocket, streaming uploads,
arbitrary methods, untrusted redirects, and browser credentials to internal Factory APIs are not
supported.

Request headers containing Factory credentials, forwarding state, hop-by-hop state, origin state,
or browser security metadata are stripped. Response headers are allowlisted and supplemented with
strict CSP, `nosniff`, no-referrer, no framing, and no-store controls. Runtime cookies, CORS grants,
server identity, and unsafe headers are not propagated.

## Authentication and ownership

Starting, inspecting, stopping, or launching a Preview always requires an authenticated principal.
A `USER` may access only an execution owned by the same user. An `ADMIN` may manage another user's
Preview through the explicit global Preview capability; ownership remains the original execution
owner and the acting administrator is only audit context. An unknown or unauthorized Preview is
projected as not found to avoid existence disclosure.

The one-time ticket is not authorization by obscurity. It is short-lived, stored only as a hash,
bound to one Preview, atomically consumed once, and invalid after stop, expiration, or revocation.
The Preview cookie is independently validated against current persisted/runtime state.

## Persistence, observability, and safe contracts

Prisma receives additive normalized tables for Preview artifact metadata, Preview sessions, ordered
events, safe provenance, and one-time ticket metadata. It stores IDs, owner relation, statuses,
health, policy/version, limits, timestamps, hashes, safe failure codes, image identity, runtime
identity, and cleanup evidence. It does not store source/build files, generated code, prompts,
specifications, model responses, stdout/stderr, request bodies, cookies/tickets in clear text, host
paths, host ports, container IDs, Docker socket values, or secrets.

Events are immutable and evidence-based: `preview.requested`, `preview.starting`,
`preview.running`, `preview.failed`, `preview.stopping`, `preview.stopped`, and `preview.expired`.
Logs expose only allowlisted correlation, status, durations, counts, hashes, and sanitized failure
codes. UI state is projected from real Factory, artifact, repository, and runtime evidence; timers
never fabricate progress.

Public `PreviewSession` and HTTP projections exclude physical runtime identity. A separate
host-only gateway locator may resolve the ephemeral `127.0.0.1` relay, but that capability is not
Zod-serializable, persistable, exported to the browser, or included in hashes. It is not a Docker
published port; its access token is likewise ephemeral and excluded from persistence and logs.

## Hashing, lineage, and provenance

New domain-separated hashes extend rather than recalculate historical hashes:

```text
factoryResultHash
  -> artifactContentHash / artifactHash
  -> artifactApprovalHash
  -> previewRequestHash
  -> lineageHash + provenanceHash
  -> previewSessionHash
```

Lineage proves the correlated successful Factory result, Sandbox result, workspace, approved
artifact, request, and session. Provenance separately records Preview component/contract versions,
policy version/hash, effective limits hash, image digest/ID/platform, runtime version, and helper
ABI. Observational timestamps, durations, physical paths, ports, container identity, tickets,
cookies, and AbortSignal do not participate in deterministic hashes.

## Consequences

### Positive

- a successful build can be viewed without weakening Factory cleanup;
- preview authority is replaceable and independent from build/test and deployment;
- generated code cannot choose commands, image, network, ports, or limits;
- unique-origin isolation protects Factory credentials and DOM;
- ownership applies to control and content access;
- TTL, reconciliation, and idempotent cleanup bound local resource lifetime;
- historical executions without Factory results or artifacts remain valid and simply ineligible.

### Trade-offs

- only the narrow static `NODE_WEB_PREVIEW_24_V1` profile is supported;
- Preview requires explicit preloaded Docker images and local origin configuration;
- in-process TTL/reconciliation is suitable for the current single-host MVP, not distributed
  production scheduling;
- a compromised Docker daemon, host kernel, or local privileged process remains outside the
  application isolation guarantee;
- no websocket, dynamic backend, external API, package ecosystem, or arbitrary framework runtime
  is supported.

## Explicit exclusions

This decision does not authorize deployment, production hosting, DNS provisioning, TLS automation,
Kubernetes, cloud containers, distributed schedulers, shared preview infrastructure, public links,
collaboration, hot reload, dev servers, websocket, retry, self-healing, automatic Preview start,
arbitrary package scripts, build/test correction, Git operations, iframe embedding, project
download, or any item of Sprint 26.
