# Sandbox Runner

Provider-neutral execution port for a controlled, terminal build-and-test run. The public request
contains only correlation metadata, a verified `WorkspaceMaterializationResult`, a trusted
`policyId`, and optional limit reductions. It cannot carry host paths, images, commands,
environment variables, mounts, or runtime flags.

The public lifecycle is fixed and sequential:

```text
PREPARE -> TYPECHECK -> BUILD -> TEST
```

`SandboxRunResult` is terminal and deeply immutable. Timestamps and durations are observational
and excluded from deterministic hashes. Lineage preserves the specification, generation, bundle,
workspace, request, and result hash chain; provenance separately records the resolved policy,
limits, sanitizer, pinned execution image, runtime, and toolchain identity.

`SandboxStepResult.timeoutMs` is the deterministic authorized ceiling derived from policy and
effective limits, not the elapsed-time-dependent operational allowance. The policy hash binds the
fixed step order and sanitizer version.

The main export has no host-execution capability. Docker is an explicit adapter exported from
`@brq/sandbox-runner/docker`. The adapter is responsible for isolation, workspace integrity,
timeouts, cancellation, output hard limits, and cleanup. A sandbox run never implies approval to
serve a preview, deploy, persist output, retry, or execute code directly on the host.

## Factory profile defense and safe reasons

The leaf `@brq/factory-execution-profile` owns `NODE_WEB_PREVIEW_24_V1`. The image contains an
immutable Sandbox projection of that profile and pins both profile and snapshot hashes in labels.
The host validates before Workspace, while the fixed `PREPARE` helper independently enforces the
snapshot again. The standard parity matrix exercises both enforcers without Docker.

Helpers may end stderr with exactly `BRQ_<STEP>_FAILED code=<CODE>`. The runner reads only the last
non-empty line, requires the exact active step, bounds the marker and accepts only a reason code in
that step's snapshot allowlist. Wrong-step, unknown, oversized, embedded or spoofed markers degrade
to `reasonCode = null`. `EXIT_1` remains internal operational diagnosis and is not promoted to the
Factory result or UI.

## Docker integration test

The normal quality gates use a fake Docker executor. The real adapter test is deliberately opt-in
and never pulls or builds an image. A minimal, auditable integration image is versioned under
`integration/image`. It contains Node 24.19.0, TypeScript 6.0.3 and fixed helpers; it has no shell,
package manager, generated command dispatch or default entrypoint. The helpers validate and
materialize the canonical envelope, perform a fixed compiler typecheck and build, and execute only
the fixed integration assertion inside the isolated container. A fixed readiness helper prepares
and verifies the tmpfs directories before `PREPARE`; this is adapter setup, not an additional
public lifecycle stage or retry.

Build the image explicitly for the local daemon before running the opt-in test:

```sh
SOURCE_DATE_EPOCH=0 BUILDX_NO_DEFAULT_ATTESTATIONS=1 docker buildx build \
  --platform linux/arm64 \
  --tag brq-ai-factory/sandbox-runner:sprint23-local \
  --load \
  --network=none \
  --provenance=false \
  --sbom=false \
  core/sandbox-runner/integration/image
```

Use `linux/amd64` instead on an amd64 daemon. The Dockerfile pins the multi-platform Node base by
digest and the TypeScript archive by SHA-256. The build remains a separate, explicit preparation
step; `npm run test:sandbox:integration` still never builds or pulls automatically.

After the build, inspect the image and set all of the following explicitly:

- `BRQ_SANDBOX_INTEGRATION=1`;
- `BRQ_SANDBOX_DOCKER_EXECUTABLE` to an absolute `docker` CLI path;
- `BRQ_SANDBOX_DOCKER_HOST` to a local Unix socket;
- `BRQ_SANDBOX_IMAGE_REFERENCE` to a digest-pinned local reference;
- `BRQ_SANDBOX_IMAGE_ID` to the expected immutable image ID;
- `BRQ_SANDBOX_IMAGE_PLATFORM` to `linux/amd64` or `linux/arm64`.

On Docker Desktop with the containerd image store, obtain the immutable values from the loaded
image rather than assuming the repository digest and image ID are equal:

```sh
export BRQ_SANDBOX_IMAGE_REFERENCE="$(docker image inspect \
  brq-ai-factory/sandbox-runner:sprint23-local --format '{{index .RepoDigests 0}}')"
export BRQ_SANDBOX_IMAGE_ID="$(docker image inspect \
  brq-ai-factory/sandbox-runner:sprint23-local --format '{{.Id}}')"
export BRQ_SANDBOX_IMAGE_PLATFORM="$(docker image inspect \
  brq-ai-factory/sandbox-runner:sprint23-local --format '{{.Os}}/{{.Architecture}}')"
export BRQ_SANDBOX_DOCKER_EXECUTABLE="$(command -v docker)"
export BRQ_SANDBOX_DOCKER_HOST="$(docker context inspect \
  "$(docker context show)" --format '{{(index .Endpoints "docker").Host}}')"
export BRQ_SANDBOX_INTEGRATION=1
npm run test:sandbox:integration
```

The preloaded image must implement helper ABI `1.0.0`, the fixed runner wrappers, the required
labels, and the closed image environment described in ADR-033. Missing prerequisites fail the
opt-in command explicitly; they are never downloaded or generated by the test. If a Docker image
store returns an empty `RepoDigests` array for locally loaded images, publish and pull the exact
image through an approved registry; do not replace the repository digest with the image ID or
weaken the verifier.
