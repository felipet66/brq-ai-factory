import type { AIGenerateOptions, AIRequest, AIResponse } from './contracts';

export interface AIProvider {
  readonly provider: string;
  generate(request: AIRequest, options?: AIGenerateOptions): Promise<AIResponse>;
}
