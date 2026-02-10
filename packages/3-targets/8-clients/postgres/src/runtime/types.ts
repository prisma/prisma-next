import type {
  ExtractCodecTypes,
  ExtractOperationTypes,
  SqlContract,
  SqlStorage,
} from '@prisma-next/sql-contract/types';
import type { SelectBuilder } from '@prisma-next/sql-lane';
import type { OrmRegistry } from '@prisma-next/sql-orm-lane';
import type { SchemaHandle } from '@prisma-next/sql-relational-core/schema';
import type {
  ExecutionContext,
  Plugin,
  Runtime,
  RuntimeVerifyOptions,
  SqlExecutionStackWithDriver,
  SqlRuntimeExtensionDescriptor,
} from '@prisma-next/sql-runtime';
import type { Client, Pool } from 'pg';

export type PostgresTargetId = 'postgres';

export type PostgresBinding =
  | { readonly kind: 'url'; readonly url: string }
  | { readonly kind: 'pgPool'; readonly pool: Pool }
  | { readonly kind: 'pgClient'; readonly client: Client };

export interface PostgresClient<TContract extends SqlContract<SqlStorage>> {
  readonly sql: SelectBuilder<
    TContract,
    unknown,
    ExtractCodecTypes<TContract>,
    ExtractOperationTypes<TContract>
  >;
  readonly schema: SchemaHandle<TContract>;
  readonly orm: OrmRegistry<TContract, ExtractCodecTypes<TContract>>;
  readonly context: ExecutionContext<TContract>;
  readonly stack: SqlExecutionStackWithDriver<PostgresTargetId>;
  runtime(): Runtime;
}

export interface PostgresOptionsBase<TContract extends SqlContract<SqlStorage>> {
  readonly binding?: PostgresBinding;
  readonly url?: string;
  readonly pg?: Pool | Client;
  readonly extensions?: readonly SqlRuntimeExtensionDescriptor<PostgresTargetId>[];
  readonly plugins?: readonly Plugin<TContract>[];
  readonly verify?: RuntimeVerifyOptions;
}

export type PostgresOptionsWithContract<TContract extends SqlContract<SqlStorage>> =
  PostgresOptionsBase<TContract> & {
    readonly contract: TContract;
    readonly contractJson?: never;
  };

export type PostgresOptionsWithContractJson<TContract extends SqlContract<SqlStorage>> =
  PostgresOptionsBase<TContract> & {
    readonly contractJson: unknown;
    readonly contract?: never;
  };

export type PostgresOptions<TContract extends SqlContract<SqlStorage>> =
  | PostgresOptionsWithContract<TContract>
  | PostgresOptionsWithContractJson<TContract>;
