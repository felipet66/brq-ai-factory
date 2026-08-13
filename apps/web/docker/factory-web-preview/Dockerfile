# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e

ARG NODE_BASE_IMAGE=node@sha256:3638d9a6fe4030bd716be989438248074489337ba3275657f93595428be4fc03
FROM ${NODE_BASE_IMAGE} AS toolchain

RUN ["/usr/local/bin/node", "-e", "if (process.version !== 'v24.19.0') process.exit(70)"]

ADD --checksum=sha256:33cd0ee1beaa8c9e9d15a9da836c62ddea4c34a42d7c2d349dbc80d94165d22a \
  https://registry.npmjs.org/typescript/-/typescript-6.0.3.tgz /tmp/typescript.tgz
RUN ["mkdir", "-p", "/opt/brq/toolchain/typescript"]
RUN ["tar", "--extract", "--gzip", "--file", "/tmp/typescript.tgz", "--strip-components=1", "--directory", "/opt/brq/toolchain/typescript"]
RUN ["/usr/local/bin/node", "-e", "const value = require('/opt/brq/toolchain/typescript/package.json'); if (value.version !== '6.0.3') process.exit(70)"]

FROM scratch

COPY --from=toolchain /lib/ /lib/
COPY --from=toolchain /usr/lib/ /usr/lib/
COPY --from=toolchain /usr/local/bin/node /usr/local/bin/node
COPY --from=toolchain --chown=0:0 /opt/brq/toolchain/typescript/ /opt/brq/toolchain/typescript/

COPY --chown=0:0 --chmod=0555 idle /opt/brq/sandbox/idle
COPY --chown=0:0 --chmod=0555 runner/common.mjs /opt/brq/runner/common.mjs
COPY --chown=0:0 --chmod=0444 runner/execution-profile.snapshot.json /opt/brq/runner/execution-profile.snapshot.json
COPY --chown=0:0 --chmod=0444 runner/ready.mjs /opt/brq/runner/ready.mjs
COPY --chown=0:0 --chmod=0444 runner/prepare.mjs /opt/brq/runner/prepare.mjs
COPY --chown=0:0 --chmod=0444 runner/typecheck.mjs /opt/brq/runner/typecheck.mjs
COPY --chown=0:0 --chmod=0444 runner/build.mjs /opt/brq/runner/build.mjs
COPY --chown=0:0 --chmod=0444 runner/test.mjs /opt/brq/runner/test.mjs
COPY --chown=0:0 --chmod=0444 runner/export.mjs /opt/brq/runner/export.mjs

ENV PATH=/usr/local/bin:/usr/bin:/bin

LABEL org.brq.sandbox.helper-abi="1.1.0" \
  org.brq.sandbox.dependency-snapshot="none" \
  org.brq.sandbox.runtime-node="24.19.0" \
  org.brq.sandbox.toolchain.node="24.19.0" \
  org.brq.sandbox.toolchain.typescript="6.0.3" \
  org.brq.sandbox.factory-profile="node-web-preview-24-v1" \
  org.brq.sandbox.execution-profile-hash="ba54cba53e383deab68a1382422e4dcadb8dc3ed14e903a026e023468dbc8b61" \
  org.brq.sandbox.execution-profile-snapshot-hash="b671aed30fd78b4bda4219c00fafd1b056e2a46afe7ea81462a9c74d5c098587" \
  org.brq.preview.artifact-export-abi="1.0.0"

USER 65532:65532
