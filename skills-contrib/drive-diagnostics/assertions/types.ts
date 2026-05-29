export type TraceRef = { event_id: string; event_type: string; note?: string };
export type AssertionStatus = 'pass' | 'fail' | 'not-checkable';
export type AssertionResult = {
  id: string;
  title: string;
  status: AssertionStatus;
  evidence: TraceRef[];
  note: string;
};
