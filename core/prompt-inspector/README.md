# Prompt Inspector

`@brq/prompt-inspector` is the transport-neutral, ephemeral inspection boundary introduced in
Sprint 20. It resolves the existing Knowledge Loader, versioned prompt assets and Prompt Builder
pipeline without invoking an agent or any AI Provider. It can also evaluate a manually supplied
candidate through the existing Response Validator, the injected agent contract schema and the
injected Business Validation function.

The workspace contains no concrete agent dependency. The application host injects a fixed set of
`PromptInspectorAgentAdapter` values composed exclusively from public agent APIs. The inspector
does not discover or register agents dynamically.

## Boundary

- no AI Provider and no OpenAI call;
- no Agent Runner and no agent execution;
- no artifact generation;
- no persistence, repository or observability integration;
- no prompt asset, output contract, Business Validation or Knowledge selection mutation;
- no cache: requests and results are strictly `EPHEMERAL`;
- logs contain only agent, stage, status, hashes, duration and sanitized error codes.

`candidateHash` identifies a manual inspection candidate. It is deliberately not exposed as a
production `responseHash`; the latter exists only inside the synthetic in-memory `AgentRunResult`
required by the public Response Validator contract and never crosses the inspector boundary.
The host composes the inspector's Prompt Builder and Response Validator with a silent dependency
logger, leaving only the inspector's allowlisted logger active, so that this internal compatibility
field is never emitted as a production response identifier.

The Prompt Inspector runtime belongs to the application host and remains separate from the
execution runtime.
