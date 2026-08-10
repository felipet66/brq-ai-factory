# Preview Runner image

Host-owned runtime image for `NODE_WEB_PREVIEW_24_V1`. It is separate from both the Factory build
container and the Sprint 23 Sandbox fixture. The adapter creates it with a read-only root filesystem,
an isolated network, no host mounts, no Docker socket, no privileges and a bounded `/preview` tmpfs.

The fixed `prepare.mjs` helper receives the approved, versioned Preview Artifact envelope through
stdin, validates every path, byte count and content hash, and materializes it only in tmpfs. The
fixed `serve.mjs` process serves that verified static artifact on internal port `8080`, exposes the
exact `/__brq/health` probe, applies restrictive browser headers and exits at the host-selected TTL.
The container has no Docker-published port: an ephemeral host relay bound only to `127.0.0.1` uses
`docker exec` without a shell to invoke the fixed `relay.mjs` helper. That helper accepts only a
bounded `GET` or `HEAD` plus a validated relative path and contacts only `127.0.0.1:8080` inside the
same container. This preserves the Docker `--internal` network and its no-egress guarantee while
providing a private target for the authenticated application gateway. No generated command,
package script, dependency installation, arbitrary host/URL or arbitrary server is used.

Build/load is explicit and opt-in:

```sh
SOURCE_DATE_EPOCH=0 BUILDX_NO_DEFAULT_ATTESTATIONS=1 docker buildx build \
  --platform linux/arm64 \
  --tag brq-ai-factory/preview-runner:sprint25-local \
  --load \
  --network=none \
  --provenance=false \
  --sbom=false \
  apps/web/docker/preview-runner
```
