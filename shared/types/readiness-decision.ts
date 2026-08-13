import type { z } from 'zod';

import type {
  readinessDecisionFactorCodeSchema,
  readinessDecisionFactorSchema,
  readinessDecisionSchema,
  readinessDecisionSourceStageSchema,
  readinessSchema,
} from '../schemas/readiness-decision.schema';

type DeepReadonly<T> = T extends (...arguments_: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

export type Readiness = z.infer<typeof readinessSchema>;
export type ReadinessDecisionSourceStage = z.infer<typeof readinessDecisionSourceStageSchema>;
export type ReadinessDecisionFactorCode = z.infer<typeof readinessDecisionFactorCodeSchema>;
export type ReadinessDecisionFactor = DeepReadonly<z.infer<typeof readinessDecisionFactorSchema>>;
export type ReadinessDecision = DeepReadonly<z.infer<typeof readinessDecisionSchema>>;
