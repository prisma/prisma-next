import type { ColumnDefaultLiteralInputValue } from '@prisma-next/contract/types';
import type { DdlColumnDefault } from '../ast/ddl-types';
import { DdlColumn, FunctionColumnDefault, LiteralColumnDefault } from '../ast/ddl-types';

export interface DdlColumnOptions {
  readonly notNull?: boolean;
  readonly primaryKey?: boolean;
  readonly default?: DdlColumnDefault;
}

export function lit(value: ColumnDefaultLiteralInputValue): LiteralColumnDefault {
  return new LiteralColumnDefault(value);
}

export function fn(expression: string): FunctionColumnDefault {
  return new FunctionColumnDefault(expression);
}

export function col(name: string, type: string, options?: DdlColumnOptions): DdlColumn {
  return new DdlColumn({ name, type, ...options });
}
