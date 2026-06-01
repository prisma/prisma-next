import type { ColumnDefault, ColumnDefaultLiteralInputValue } from '@prisma-next/contract/types';
import { isColumnDefaultLiteralInputValue } from '@prisma-next/contract/types';
import type { DdlColumn } from '../ast/ddl-types';

export interface DdlColumnOptions {
  readonly notNull?: boolean;
  readonly primaryKey?: boolean;
  readonly default?: ColumnDefault;
}

export function lit(value: ColumnDefaultLiteralInputValue): ColumnDefault {
  if (!isColumnDefaultLiteralInputValue(value)) {
    throw new Error('Invalid column default literal value');
  }
  return Object.freeze({ kind: 'literal', value });
}

export function fn(expression: string): ColumnDefault {
  return Object.freeze({ kind: 'function', expression });
}

export function col(name: string, type: string, options?: DdlColumnOptions): DdlColumn {
  return Object.freeze({
    name,
    type,
    ...(options?.notNull ? { notNull: true } : {}),
    ...(options?.primaryKey ? { primaryKey: true } : {}),
    ...(options?.default !== undefined ? { default: options.default } : {}),
  });
}
