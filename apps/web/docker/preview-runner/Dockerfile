# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e

ARG NODE_BASE_IMAGE=node@sha256:3638d9a6fe4030bd716be989438248074489337ba3275657f93595428be4fc03
FROM ${NODE_BASE_IMAGE} AS runtime

RUN ["/usr/local/bin/node", "-e", "if (process.version !== 'v24.19.0') process.exit(70)"]

FROM scratch

COPY --from=runtime /lib/ /lib/
COPY --from=runtime /usr/lib/ /usr/lib/
COPY --from=runtime /usr/local/bin/node /usr/local/bin/node

COPY --chown=0:0 --chmod=0555 idle /opt/brq/preview/idle
COPY --chown=0:0 --chmod=0555 runner/common.mjs /opt/brq/preview/common.mjs
COPY --chown=0:0 --chmod=0444 runner/prepare.mjs /opt/brq/preview/prepare.mjs
COPY --chown=0:0 --chmod=0444 runner/serve.mjs /opt/brq/preview/serve.mjs
COPY --chown=0:0 --chmod=0444 runner/relay.mjs /opt/brq/preview/relay.mjs

ENV PATH=/usr/local/bin:/usr/bin:/bin

LABEL org.brq.preview.helper-abi="1.0.0" \
  org.brq.preview.runtime-node="24.19.0" \
  org.brq.preview.profile="node-web-preview-24-v1"

USER 65532:65532
