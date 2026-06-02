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

  /**
   * Structural brand: every DDL node answers `true`. Lets {@link isDdlNode}
   * recognise any `DdlNode` subclass — including target-contributed kinds —
   * without a central kind registry that subclasses would have to register
   * into.
   */
  isDdlNode(): true {
    return true;
  }

  protected freeze(): void {
    Object.freeze(this);
  }

  collectParamRefs(): AnyParamRef[] {
    return [];
  }
}

export function isDdlNode(value: unknown): value is DdlNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    'isDdlNode' in value &&
    typeof value.isDdlNode === 'function'
  );
}
