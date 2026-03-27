import type { ParamDescriptor, PlanRefs } from '@prisma-next/contract/types';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { AnyQueryAst } from '@prisma-next/sql-relational-core/ast';

export interface TransformResult {
  readonly ast: AnyQueryAst;
  readonly metaAdditions: {
    readonly refs: PlanRefs;
    readonly paramDescriptors: ReadonlyArray<ParamDescriptor>;
    readonly projection?: Record<string, string> | ReadonlyArray<string>;
    readonly projectionTypes?: Record<string, string>;
    readonly selectAllIntent?: { table?: string };
    readonly limit?: number;
  };
}

export interface TransformContext {
  contract: SqlContract<SqlStorage>;
  parameters: readonly unknown[] | undefined;
  paramIndex: number;
  params: unknown[];
  paramDescriptors: ParamDescriptor[];
  refsTables: Set<string>;
  refsColumns: Map<string, { table: string; column: string }>;
  tableAliases: Map<string, string>;
  multiTableScope?: boolean;
}

export function createContext(
  contract: SqlContract<SqlStorage>,
  parameters?: readonly unknown[],
): TransformContext {
  return {
    contract,
    parameters,
    paramIndex: 0,
    params: [],
    paramDescriptors: [],
    refsTables: new Set(),
    refsColumns: new Map(),
    tableAliases: new Map(),
  };
}

export function nextParamIndex(ctx: TransformContext): number {
  return ++ctx.paramIndex;
}

export function addParamDescriptor(
  ctx: TransformContext,
  descriptor: Omit<ParamDescriptor, 'index' | 'source'>,
): void {
  ctx.paramDescriptors.push({
    ...descriptor,
    index: ctx.paramIndex,
    source: 'lane',
  });
}
