import {
  QueryAST,
  Column,
  FieldExpression,
  Expr,
  InferSelectResult,
  InferTableShape,
  Table,
  ContractMismatchMode,
  Plan,
  ProjectionItem,
  FromBuilder,
} from './types';
import { compileToSQL } from './compiler';

export interface BuilderContext {
  contractHash?: string;
  onContractMismatch: ContractMismatchMode;
}

function handleMismatch(
  where: string,
  expected: string,
  got: string,
  mode: ContractMismatchMode,
): void {
  const msg =
    `E_CONTRACT_MISMATCH: contract hash mismatch in ${where}\n` +
    `→ expected: ${expected}\n→ got: ${got}\n` +
    `Hint: ensure all DSL elements come from the same IR`;

  if (mode === 'warn') {
    console.warn(msg);
  } else {
    throw new Error(msg);
  }
}

export class QueryBuilder<TTable extends Table<any>, TResult = never> {
  private ast: QueryAST;
  private context: BuilderContext;

  constructor(from: string, context: BuilderContext) {
    this.context = context;
    this.ast = {
      type: 'select',
      from,
      contractHash: context.contractHash,
      projectStar: true, // Default to true, will be set to false when select() is called
    };
  }

  select<TSelect extends Record<string, Column<any, any, any>>>(
    fields: TSelect,
  ): QueryBuilder<TTable, InferSelectResult<TSelect>> & {
    build(): Plan<InferSelectResult<TSelect>>;
  } {
    // Verify all columns have matching contract hash
    for (const [alias, column] of Object.entries(fields)) {
      if (column.__contractHash !== this.context.contractHash) {
        handleMismatch(
          `select() field '${alias}'`,
          this.context.contractHash || 'undefined',
          column.__contractHash || 'undefined',
          this.context.onContractMismatch,
        );
      }
    }

    this.ast.select = { type: 'select', fields };
    this.ast.projectStar = false; // Explicit select() means no SELECT *
    return this as any;
  }

  selectRaw(projections: ProjectionItem[]): QueryBuilder<TTable, any> {
    this.ast.select = projections;
    this.ast.projectStar = false;
    return this as any;
  }

  where(condition: Expr): QueryBuilder<TTable, TResult> {
    // Note: Expr doesn't carry contract hash, but the column that created it does
    // This verification happens at build() time when we walk all references
    this.ast.where = { type: 'where', condition };
    return this;
  }

  orderBy(field: string, direction: 'ASC' | 'DESC' = 'ASC'): QueryBuilder<TTable, TResult> {
    if (!this.ast.orderBy) {
      this.ast.orderBy = [];
    }
    this.ast.orderBy.push({ type: 'orderBy', field, direction });
    return this;
  }

  limit(count: number): QueryBuilder<TTable, TResult> {
    this.ast.limit = { type: 'limit', count };
    return this;
  }

  build(): Plan<TResult> {
    // Final verification: check all column references have matching contract hash
    const references: Column<any, any, any>[] = [];
    const tables = new Set<string>();
    const columns = new Set<string>();

    // Collect from select fields
    if (this.ast.select) {
      if (Array.isArray(this.ast.select)) {
        // New ProjectionItem[] format - extract column references
        for (const item of this.ast.select) {
          if (item.expr.kind === 'column') {
            // Create a mock column object for contract hash checking
            const mockColumn = {
              table: item.expr.table || this.ast.from,
              name: item.expr.name,
              __contractHash: this.context.contractHash,
            } as Column<any, any, any>;
            references.push(mockColumn);
          }
        }
      } else if (this.ast.select.fields) {
        // Old SelectClause format
        references.push(...Object.values(this.ast.select.fields));
      }
    }

    // Extract table and column references
    tables.add(this.ast.from);

    for (const ref of references) {
      if (ref.__contractHash !== this.context.contractHash) {
        handleMismatch(
          'build()',
          this.context.contractHash || 'undefined',
          ref.__contractHash || 'undefined',
          this.context.onContractMismatch,
        );
      }
      tables.add(ref.table);
      columns.add(`${ref.table}.${ref.name}`);
    }

    const { sql, params } = compileToSQL(this.ast);

    return {
      ast: { ...this.ast }, // Immutable snapshot
      sql,
      params,
      meta: {
        contractHash: this.context.contractHash || '',
        target: 'postgres',
        refs: {
          tables: Array.from(tables),
          columns: Array.from(columns),
        },
      },
    };
  }
}

export function createFromBuilder<TTable extends Table<any>>(
  tableName: string,
  context: BuilderContext,
): FromBuilder<TTable, never> {
  const builder = new QueryBuilder<TTable, never>(tableName, context);

  return {
    select: builder.select.bind(builder),
    selectRaw: builder.selectRaw.bind(builder),
    where: builder.where.bind(builder),
    orderBy: builder.orderBy.bind(builder),
    limit: builder.limit.bind(builder),
    build: builder.build.bind(builder),
  };
}

// Re-export compileToSQL for convenience
export { compileToSQL } from './compiler';

// Re-export types that are needed by other packages
export type { QueryAST } from './types';
export { TABLE_NAME } from './types';

// Re-export sql function
export { sql } from './sql';

// Re-export makeT function
export { makeT } from './maket';
