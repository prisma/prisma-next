import type { ColumnDefaultLiteralInputValue } from '@prisma-next/contract/types';
import { isColumnDefaultLiteralInputValue } from '@prisma-next/contract/types';
import type { AnyParamRef } from './types';

export interface DdlColumnDefaultVisitor<R> {
  literal(node: LiteralColumnDefault): R;
  function(node: FunctionColumnDefault): R;
}

export abstract class DdlColumnDefault {
  abstract readonly kind: string;
  abstract accept<R>(visitor: DdlColumnDefaultVisitor<R>): R;

  protected freeze(): void {
    Object.freeze(this);
  }
}

export class LiteralColumnDefault extends DdlColumnDefault {
  readonly kind = 'literal' as const;
  readonly value: ColumnDefaultLiteralInputValue;

  constructor(value: ColumnDefaultLiteralInputValue) {
    super();
    if (!isColumnDefaultLiteralInputValue(value)) {
      throw new Error('Invalid column default literal value');
    }
    this.value = value;
    this.freeze();
  }

  override accept<R>(visitor: DdlColumnDefaultVisitor<R>): R {
    return visitor.literal(this);
  }
}

export class FunctionColumnDefault extends DdlColumnDefault {
  readonly kind = 'function' as const;
  readonly expression: string;

  constructor(expression: string) {
    super();
    this.expression = expression;
    this.freeze();
  }

  override accept<R>(visitor: DdlColumnDefaultVisitor<R>): R {
    return visitor.function(this);
  }
}

export type AnyDdlColumnDefault = LiteralColumnDefault | FunctionColumnDefault;

export class DdlColumn {
  readonly name: string;
  readonly type: string;
  readonly notNull?: boolean | undefined;
  readonly primaryKey?: boolean | undefined;
  readonly default?: DdlColumnDefault | undefined;

  constructor(options: {
    readonly name: string;
    readonly type: string;
    readonly notNull?: boolean;
    readonly primaryKey?: boolean;
    readonly default?: DdlColumnDefault;
  }) {
    this.name = options.name;
    this.type = options.type;
    this.notNull = options.notNull;
    this.primaryKey = options.primaryKey;
    this.default = options.default;
    Object.freeze(this);
  }
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
