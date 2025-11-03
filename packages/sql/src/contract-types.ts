import type { ContractBase } from '@prisma-next/contract/types';

// SQL family types
export interface StorageColumn {
  readonly type?: string;
  readonly nullable?: boolean;
}

export interface StorageTable {
  readonly columns: Record<string, StorageColumn>;
  readonly primaryKey?: {
    readonly columns: ReadonlyArray<string>;
    readonly name?: string;
  };
  readonly uniques?: ReadonlyArray<{
    readonly columns: ReadonlyArray<string>;
    readonly name?: string;
  }>;
  readonly indexes?: ReadonlyArray<{
    readonly columns: ReadonlyArray<string>;
    readonly name?: string;
  }>;
  readonly foreignKeys?: ReadonlyArray<{
    readonly columns: ReadonlyArray<string>;
    readonly references: {
      readonly table: string;
      readonly columns: ReadonlyArray<string>;
    };
    readonly name?: string;
  }>;
}

export interface SqlStorage {
  readonly tables: Record<string, StorageTable>;
}

export interface SqlMappings {
  readonly ModelToTable?: Record<string, string>;
  readonly TableToModel?: Record<string, string>;
  readonly FieldToColumn?: Record<string, Record<string, string>>;
  readonly ColumnToField?: Record<string, Record<string, string>>;
}

export interface SqlContract<
  S extends SqlStorage = SqlStorage,
  M extends Record<string, unknown> = Record<string, unknown>,
  R extends Record<string, unknown> = Record<string, unknown>,
  Map extends SqlMappings = SqlMappings,
> extends ContractBase {
  readonly targetFamily: string;
  readonly storage: S;
  readonly models: M;
  readonly relations: R;
  readonly Mappings: Map;
}
