# Factory Sandbox profile

Host-owned Docker image for the `NODE_TYPESCRIPT_24_V1` Factory Pipeline policy. It is separate
from the Sprint 23 adapter fixture and supports a deliberately bounded Node.js profile: UTF-8
`.ts`/`.js` sources, no dependency installation, no package scripts, fixed TypeScript typecheck and
build helpers, and Node's fixed test runner for verified `*.test.ts`/`*.test.js` outputs.

The image is never built, pulled, or selected by generated code. Build and load it explicitly for
the local daemon, then configure the application with a repository digest and immutable image ID.
Use the daemon platform (`linux/arm64` or `linux/amd64`):

```sh
SOURCE_DATE_EPOCH=0 BUILDX_NO_DEFAULT_ATTESTATIONS=1 docker buildx build \
  --platform linux/arm64 \
  --tag brq-ai-factory/factory-sandbox:sprint24-local \
  --load \
  --network=none \
  --provenance=false \
  --sbom=false \
  apps/web/docker/factory-sandbox
```

The application requires all `BRQ_FACTORY_SANDBOX_*` settings documented in the root README. It
does not fall back to a fake runner when configuration is absent. Projects outside this fixed
profile fail closed during PREPARE, TYPECHECK, BUILD, or TEST; the profile never adapts by running
commands or scripts proposed in generated files.

After exporting that explicit configuration, the separate end-to-end profile check can be run
against the preloaded image with:

```sh
BRQ_FACTORY_SANDBOX_INTEGRATION=1 npm run test:factory:integration
```

The command is intentionally opt-in and performs neither image build nor pull.
