import type { TraceEvent } from '../schema.ts';
import { checkBriefDiscipline } from './brief.ts';
import { checkCascadeRules } from './cascade.ts';
import { checkInvariants } from './invariants.ts';
import type { AssertionResult } from './types.ts';

export type { AssertionResult, AssertionStatus, TraceRef } from './types.ts';

export function runAssertions(events: TraceEvent[]): AssertionResult[] {
  return [
    ...checkInvariants(events),
    ...checkCascadeRules(events),
    ...checkBriefDiscipline(events),
  ];
}
