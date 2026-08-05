import type { PromptRequest } from './contracts';

export function toPromptBuilderRequest(request: PromptRequest) {
  return {
    template: request.template,
    ruleSets: request.ruleSets,
    contexts: request.contexts,
    variables: request.variables,
    constraints: request.constraints,
    outputContract: request.outputContract,
  };
}
