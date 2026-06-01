import type { ColumnDefault } from '@prisma-next/contract/types';
import type { AnyParamRef } from './types';

export interface DdlColumn {
  readonly name: string;
  readonly type: string;
  readonly notNull?: boolean;
  readonly primaryKey?: boolean;
  readonly default?: ColumnDefault;
}

export abstract class DdlNode {
  abstract readonly kind: string;

  protected freeze(): void {
    Object.freeze(this);
  }

  collectParamRefs(): AnyParamRef[] {
    return [];
  }
}

export const ddlAstKinds: ReadonlySet<string> = new Set(['create-table', 'create-schema']);

export function isAnyDdlNode(value: unknown): value is DdlNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    ddlAstKinds.has((value as { kind: string }).kind)
  );
}
