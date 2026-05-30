import type { TraceEvent } from '../../drive-record-traces/schema.ts';
import { checkBriefDiscipline } from './brief.ts';
import { checkCascadeRules } from './cascade.ts';
import { checkInvariants } from './invariants.ts';
import type { AssertionResult } from './types.ts';

export function runAssertions(events: TraceEvent[]): AssertionResult[] {
  return [
    ...checkInvariants(events),
    ...checkCascadeRules(events),
    ...checkBriefDiscipline(events),
  ];
}
