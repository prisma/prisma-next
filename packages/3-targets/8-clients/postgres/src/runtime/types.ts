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
  OperationTypeSignature,
  OperationTypes,
} from '@prisma-next/sql-relational-core/types';
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

export type PostgresBindingInput =
  | {
      readonly binding: PostgresBinding;
      readonly url?: never;
      readonly pg?: never;
    }
  | {
      readonly url: string;
      readonly binding?: never;
      readonly pg?: never;
    }
  | {
      readonly pg: Pool | Client;
      readonly binding?: never;
      readonly url?: never;
    };

type NormalizeOperationTypes<T> = {
  [TypeId in keyof T]: {
    [Method in keyof T[TypeId]]: T[TypeId][Method] extends OperationTypeSignature
      ? T[TypeId][Method]
      : OperationTypeSignature;
  };
};

type ToSchemaOperationTypes<T> = T extends OperationTypes ? T : NormalizeOperationTypes<T>;

export interface PostgresClient<TContract extends SqlContract<SqlStorage>> {
  readonly sql: SelectBuilder<
    TContract,
    unknown,
    ExtractCodecTypes<TContract>,
    ExtractOperationTypes<TContract>
  >;
  readonly schema: SchemaHandle<
    TContract,
    ExtractCodecTypes<TContract>,
    ToSchemaOperationTypes<ExtractOperationTypes<TContract>>
  >;
  readonly orm: OrmRegistry<TContract, ExtractCodecTypes<TContract>>;
  readonly context: ExecutionContext<TContract>;
  readonly stack: SqlExecutionStackWithDriver<PostgresTargetId>;
  runtime(): Runtime;
}

export interface PostgresOptionsBase<TContract extends SqlContract<SqlStorage>> {
  readonly extensions?: readonly SqlRuntimeExtensionDescriptor<PostgresTargetId>[];
  readonly plugins?: readonly Plugin<TContract>[];
  readonly verify?: RuntimeVerifyOptions;
}

export type PostgresOptionsWithContract<TContract extends SqlContract<SqlStorage>> =
  PostgresBindingInput &
    PostgresOptionsBase<TContract> & {
      readonly contract: TContract;
      readonly contractJson?: never;
    };

export type PostgresOptionsWithContractJson<TContract extends SqlContract<SqlStorage>> =
  PostgresBindingInput &
    PostgresOptionsBase<TContract> & {
      readonly contractJson: unknown;
      readonly contract?: never;
    };

export type PostgresOptions<TContract extends SqlContract<SqlStorage>> =
  | PostgresOptionsWithContract<TContract>
  | PostgresOptionsWithContractJson<TContract>;
