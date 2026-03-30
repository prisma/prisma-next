import type { ParamDescriptor } from '@prisma-next/contract/types';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { TableRef } from '@prisma-next/sql-relational-core/ast';
import type {
  AnyBinaryBuilder,
  AnyExpressionSource,
  AnyOrderBuilder,
  AnyUnaryBuilder,
  NestedProjection,
} from '@prisma-next/sql-relational-core/types';
import type { ProjectionState } from '../utils/state';

export type ProjectionInput = Record<string, AnyExpressionSource | boolean | NestedProjection>;

export interface MetaBuildArgs {
  readonly contract: SqlContract<SqlStorage>;
  readonly table: TableRef;
  readonly projection: ProjectionState;
  readonly joins?: ReadonlyArray<{
    readonly joinType: 'inner' | 'left' | 'right' | 'full';
    readonly table: TableRef;
    readonly on: {
      readonly left: unknown;
      readonly right: unknown;
    };
  }>;
  readonly includes?: ReadonlyArray<{
    readonly alias: string;
    readonly table: TableRef;
    readonly on: {
      readonly left: unknown;
      readonly right: unknown;
    };
    readonly childProjection: ProjectionState;
    readonly childWhere?: AnyBinaryBuilder | AnyUnaryBuilder;
    readonly childOrderBy?: AnyOrderBuilder;
  }>;
  readonly where?: AnyBinaryBuilder | AnyUnaryBuilder;
  readonly orderBy?: AnyOrderBuilder;
  readonly limit?: number;
  readonly paramDescriptors: ParamDescriptor[];
}
