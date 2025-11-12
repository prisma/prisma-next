import type { Plan } from '@prisma-next/contract/types';

export interface MarkerStatement {
  readonly sql: string;
  readonly params: readonly unknown[];
}

export interface MarkerReader {
  readMarkerStatement(): MarkerStatement;
}

export interface RuntimeFamilyAdapter<TContract = unknown> {
  readonly contract: TContract;
  readonly markerReader: MarkerReader;
  validatePlan(plan: Plan, contract: TContract): void;
}
