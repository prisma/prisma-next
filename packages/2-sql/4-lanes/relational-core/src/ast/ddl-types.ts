import type { AnyParamRef } from './types';

export interface DdlColumn {
  readonly name: string;
  readonly type: string;
  readonly notNull?: boolean;
  readonly primaryKey?: boolean;
}

export interface DdlVisitor<R> {
  createTable(node: CreateTable): R;
}

abstract class DdlNode {
  abstract readonly kind: string;

  protected freeze(): void {
    Object.freeze(this);
  }

  abstract accept<R>(visitor: DdlVisitor<R>): R;

  collectParamRefs(): AnyParamRef[] {
    return [];
  }
}

function freezeDdlColumns(columns: readonly DdlColumn[]): ReadonlyArray<DdlColumn> {
  return Object.freeze(columns.map((column) => Object.freeze({ ...column })));
}

export class CreateTable extends DdlNode {
  readonly kind = 'create-table' as const;
  readonly table: string;
  readonly schema: string | undefined;
  readonly columns: ReadonlyArray<DdlColumn>;

  constructor(options: {
    readonly table: string;
    readonly schema?: string;
    readonly columns: readonly DdlColumn[];
  }) {
    super();
    this.table = options.table;
    this.schema = options.schema;
    this.columns = freezeDdlColumns(options.columns);
    this.freeze();
  }

  override accept<R>(visitor: DdlVisitor<R>): R {
    return visitor.createTable(this);
  }
}

export type AnyDdlNode = CreateTable;

export const ddlAstKinds: ReadonlySet<string> = new Set<AnyDdlNode['kind']>(['create-table']);

export function isAnyDdlNode(value: unknown): value is AnyDdlNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    ddlAstKinds.has((value as { kind: string }).kind)
  );
}
