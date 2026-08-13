import type { AIGenerateOptions, AIRequest, AIResponse } from './contracts';

export interface AIProviderCapabilities {
  /** The provider can serve an exact request from cache without external generation. */
  readonly exactResponseCache?: true;
}

export interface AIProvider {
  readonly provider: string;
  readonly capabilities?: AIProviderCapabilities;
  generate(request: AIRequest, options?: AIGenerateOptions): Promise<AIResponse>;
}
