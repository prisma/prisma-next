// Shared header and neutral types
// Note: Fields like targetFamily accept string to work with JSON imports,
// which don't preserve literal types. Runtime validation ensures correct values
export interface ContractBase {
  readonly schemaVersion: string;
  readonly target: string;
  readonly targetFamily: string;
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

export interface DocumentContract extends ContractBase {
  // Accept string to work with JSON imports; runtime validation ensures 'document'
  readonly targetFamily: string;
  readonly storage: DocumentStorage;
}
