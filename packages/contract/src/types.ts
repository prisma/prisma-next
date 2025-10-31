// Shared header and neutral types
export interface ContractHeader {
  readonly schemaVersion?: '1';
  readonly target: string;
  readonly targetFamily: 'sql' | 'document';
  readonly coreHash: string;
  readonly profileHash?: string;
  readonly capabilities?: Record<string, Record<string, boolean>>;
  readonly extensions?: Record<string, unknown>;
  readonly meta?: Record<string, unknown>;
  readonly sources?: Record<string, Source>;
}

export interface FieldType {
  readonly type: string;
  readonly nullable: boolean;
  readonly items?: FieldType;
  readonly properties?: Record<string, FieldType>;
}

export interface Source {
  readonly readOnly: boolean;
  readonly projection: Record<string, FieldType>;
  readonly origin?: Record<string, unknown>;
  readonly capabilities?: Record<string, boolean>;
}

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

export interface SqlContract extends ContractHeader {
  readonly targetFamily: 'sql';
  readonly storage: SqlStorage;
}

// Document family types
export interface DocIndex {
  readonly name: string;
  readonly keys: Record<string, 'asc' | 'desc'>;
  readonly unique?: boolean;
  readonly where?: Expr;
}

export type Expr =
  | { readonly kind: 'eq'; readonly path: ReadonlyArray<string>; readonly value: unknown }
  | { readonly kind: 'exists'; readonly path: ReadonlyArray<string> };

export interface DocCollection {
  readonly name: string;
  readonly id?: {
    readonly strategy: 'auto' | 'client' | 'uuid' | 'cuid' | 'objectId';
  };
  readonly fields: Record<string, FieldType>;
  readonly indexes?: ReadonlyArray<DocIndex>;
  readonly readOnly?: boolean;
}

export interface DocumentStorage {
  readonly document: {
    readonly collections: Record<string, DocCollection>;
  };
}

export interface DocumentContract extends ContractHeader {
  readonly targetFamily: 'document';
  readonly storage: DocumentStorage;
}

// Union type for both families
export type DataContract = SqlContract | DocumentContract;

// Backward compatibility: deprecated types
/**
 * @deprecated Use `SqlContract` or `DocumentContract` instead. This type is kept for backward compatibility.
 */
export interface ContractStorage {
  readonly tables: Record<string, StorageTable>;
}
