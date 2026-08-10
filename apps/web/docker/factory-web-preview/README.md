# Factory Web Preview profile

Host-owned, digest-pinned Docker profile for `NODE_WEB_PREVIEW_24_V1`. It preserves the fixed
`PREPARE -> TYPECHECK -> BUILD -> TEST` Sandbox lifecycle and adds a private `export.mjs` helper
that may be invoked only by the opt-in artifact-capturing Docker adapter after TEST succeeds and
before the Sandbox container is removed.

The profile accepts a deliberately narrow static web project: `index.html`, local HTML/CSS/JS/TS,
JSON/SVG/XML/text assets, and Node `*.test.js`/`*.test.ts` tests. It rejects package scripts,
dependencies, external resource references, inline active content, network/browser escape APIs,
unsupported extensions and missing tests. It never chooses or runs a command supplied by generated
code.

The export helper emits the canonical versioned Preview Artifact envelope through a bounded private
channel. The normal Sandbox result remains metadata-only. The Controlled Workspace and the build
container are still removed normally.

Build and load explicitly; the application never pulls or builds it automatically:

```sh
SOURCE_DATE_EPOCH=0 BUILDX_NO_DEFAULT_ATTESTATIONS=1 docker buildx build \
  --platform linux/arm64 \
  --tag brq-ai-factory/factory-web-preview:sprint25-local \
  --load \
  --network=none \
  --provenance=false \
  --sbom=false \
  apps/web/docker/factory-web-preview
```
