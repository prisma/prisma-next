import type { CodecTrait } from '@prisma-next/framework-components/codec';
import type { ControlDriverInstance } from '@prisma-next/framework-components/control';
import type { ReferentialAction } from './ir/foreign-key';

export interface SqlControlDriverInstance<T extends string = string>
  extends ControlDriverInstance<'sql', T> {
  query<Row = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ readonly rows: Row[] }>;
}

export { buildSqlNamespace, buildSqlNamespaceMap } from './ir/build-sql-namespace';
export {
  ForeignKey,
  type ForeignKeyInput,
  type ReferentialAction,
} from './ir/foreign-key';
export {
  ForeignKeyReference,
  type ForeignKeyReferenceInput,
} from './ir/foreign-key-reference';
export {
  isPostgresEnumStorageEntry,
  POSTGRES_ENUM_KIND,
  type PostgresEnumStorageEntry,
} from './ir/postgres-enum-storage-entry';
export { PrimaryKey, type PrimaryKeyInput } from './ir/primary-key';
export { Index, type IndexInput } from './ir/sql-index';
export { SqlNode } from './ir/sql-node';
export {
  type SqlNamespaceTablesInput,
  SqlStorage,
  type SqlStorageInput,
  type SqlStorageTypeEntry,
  storageTableAt,
} from './ir/sql-storage';
export { SqlUnboundNamespace } from './ir/sql-unbound-namespace';
export { StorageColumn, type StorageColumnInput } from './ir/storage-column';
export { StorageTable, type StorageTableInput } from './ir/storage-table';
export {
  CODEC_INSTANCE_KIND,
  isStorageTypeInstance,
  type StorageTypeInstance,
  type StorageTypeInstanceInput,
  toStorageTypeInstance,
} from './ir/storage-type-instance';
export { StorageValueSet, type StorageValueSetInput } from './ir/storage-value-set';
export {
  UniqueConstraint,
  type UniqueConstraintInput,
} from './ir/unique-constraint';

export type ForeignKeyOptions = {
  readonly name?: string;
  readonly onDelete?: ReferentialAction;
  readonly onUpdate?: ReferentialAction;
};

export type SqlModelFieldStorage = {
  readonly column: string;
  readonly codecId?: string;
  readonly nullable?: boolean;
};

export type SqlModelStorage = {
  readonly table: string;
  readonly namespaceId: string;
  readonly fields: Record<string, SqlModelFieldStorage>;
};

export const DEFAULT_FK_CONSTRAINT = true;
export const DEFAULT_FK_INDEX = true;

export function applyFkDefaults(
  fk: { constraint?: boolean | undefined; index?: boolean | undefined },
  overrideDefaults?: { constraint?: boolean | undefined; index?: boolean | undefined },
): { constraint: boolean; index: boolean } {
  return {
    constraint: fk.constraint ?? overrideDefaults?.constraint ?? DEFAULT_FK_CONSTRAINT,
    index: fk.index ?? overrideDefaults?.index ?? DEFAULT_FK_INDEX,
  };
}

export type TypeMaps<
  TCodecTypes extends Record<string, { output: unknown }> = Record<string, never>,
  TQueryOperationTypes extends Record<string, unknown> = Record<string, never>,
  TFieldOutputTypes extends Record<string, Record<string, unknown>> = Record<string, never>,
  TFieldInputTypes extends Record<string, Record<string, unknown>> = Record<string, never>,
> = {
  readonly codecTypes: TCodecTypes;
  readonly queryOperationTypes: TQueryOperationTypes;
  readonly fieldOutputTypes: TFieldOutputTypes;
  readonly fieldInputTypes: TFieldInputTypes;
};

export type CodecTypesOf<T> = [T] extends [never]
  ? Record<string, never>
  : T extends { readonly codecTypes: infer C }
    ? C extends Record<string, { output: unknown }>
      ? C
      : Record<string, never>
    : Record<string, never>;

/**
 * Dispatch hint identifying the first-argument target of an operation.
 *
 * Used by ORM column helpers to decide whether an operation is reachable on a
 * field. Either names a concrete codec identity or a set of capability traits
 * that the field's codec must carry.
 */
export type QueryOperationSelfSpec =
  | { readonly codecId: string; readonly traits?: never }
  | { readonly traits: readonly CodecTrait[]; readonly codecId?: never };

/**
 * Structural shape an operation's impl must return: any value carrying a
 * codec-exact `returnType` descriptor. `Expression<T>` (from
 * `@prisma-next/sql-relational-core/expression`, with `T extends ScopeField`)
 * extends this. Trait-targeted returns are deliberately excluded — predicate
 * detection and result decoding both depend on knowing the concrete return
 * codec.
 */
export type QueryOperationReturn = {
  readonly returnType: { readonly codecId: string; readonly nullable: boolean };
};

export type QueryOperationTypeEntry = {
  readonly self?: QueryOperationSelfSpec;
  readonly impl: (...args: never[]) => QueryOperationReturn;
};

export type SqlQueryOperationTypes<
  _CT extends Record<string, { readonly input: unknown; readonly output: unknown }>,
  T extends Record<string, QueryOperationTypeEntry>,
> = T;

export type QueryOperationTypesBase = Record<string, QueryOperationTypeEntry>;

export type QueryOperationTypesOf<T> = [T] extends [never]
  ? Record<string, never>
  : T extends { readonly queryOperationTypes: infer Q }
    ? Q extends Record<string, unknown>
      ? Q
      : Record<string, never>
    : Record<string, never>;

export type TypeMapsPhantomKey = '__@prisma-next/sql-contract/typeMaps@__';

export type ContractWithTypeMaps<TContract, TTypeMaps> = TContract & {
  readonly [K in TypeMapsPhantomKey]?: TTypeMaps;
};

export type ExtractTypeMapsFromContract<T> = TypeMapsPhantomKey extends keyof T
  ? NonNullable<T[TypeMapsPhantomKey & keyof T]>
  : never;

export type FieldOutputTypesOf<T> = [T] extends [never]
  ? Record<string, never>
  : T extends { readonly fieldOutputTypes: infer F }
    ? F extends Record<string, Record<string, unknown>>
      ? F
      : Record<string, never>
    : Record<string, never>;

export type FieldInputTypesOf<T> = [T] extends [never]
  ? Record<string, never>
  : T extends { readonly fieldInputTypes: infer F }
    ? F extends Record<string, Record<string, unknown>>
      ? F
      : Record<string, never>
    : Record<string, never>;

export type ExtractCodecTypes<T> = CodecTypesOf<ExtractTypeMapsFromContract<T>>;
export type ExtractQueryOperationTypes<T> = QueryOperationTypesOf<ExtractTypeMapsFromContract<T>>;
export type ExtractFieldOutputTypes<T> = FieldOutputTypesOf<ExtractTypeMapsFromContract<T>>;
export type ExtractFieldInputTypes<T> = FieldInputTypesOf<ExtractTypeMapsFromContract<T>>;

export type ResolveCodecTypes<TContract, TTypeMaps> = [TTypeMaps] extends [never]
  ? ExtractCodecTypes<TContract>
  : CodecTypesOf<TTypeMaps>;
