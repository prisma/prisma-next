import type { ColumnDefaultLiteralInputValue } from '@prisma-next/contract/types';
import type { ReferentialAction } from '@prisma-next/sql-contract/types';
import type { AnyDdlColumnDefault } from '../ast/ddl-types';
import {
  DdlColumn,
  ForeignKeyConstraint,
  FunctionColumnDefault,
  LiteralColumnDefault,
  PrimaryKeyConstraint,
  UniqueConstraint,
} from '../ast/ddl-types';

export interface DdlColumnOptions {
  readonly notNull?: boolean;
  readonly primaryKey?: boolean;
  readonly default?: AnyDdlColumnDefault;
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

export function primaryKey(
  columns: readonly string[],
  options?: { readonly name?: string },
): PrimaryKeyConstraint {
  return new PrimaryKeyConstraint({ columns, ...options });
}

export function foreignKey(
  columns: readonly string[],
  refTable: string,
  refColumns: readonly string[],
  options?: {
    readonly name?: string;
    readonly onDelete?: ReferentialAction;
    readonly onUpdate?: ReferentialAction;
  },
): ForeignKeyConstraint {
  return new ForeignKeyConstraint({ columns, refTable, refColumns, ...options });
}

export function unique(
  columns: readonly string[],
  options?: { readonly name?: string },
): UniqueConstraint {
  return new UniqueConstraint({ columns, ...options });
}
