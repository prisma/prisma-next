export type ContractColumnDefault =
  | {
      kind: 'literal';
      expression: string;
    }
  | {
      kind: 'function';
      expression: string;
    };

export interface PrismaContractColumn {
  nativeType: string;
  codecId: string;
  nullable: boolean;
  typeParams?: Record<string, unknown> | undefined;
  typeRef?: string | undefined;
  default?: ContractColumnDefault | undefined;
}

export interface PrismaContractTable {
  columns: Record<string, PrismaContractColumn>;
  primaryKey?:
    | {
        columns: string[];
        name?: string | undefined;
      }
    | undefined;
  uniques: Array<{
    columns: string[];
    name?: string | undefined;
  }>;
  indexes: Array<{
    columns: string[];
    name?: string | undefined;
  }>;
  foreignKeys: Array<{
    columns: string[];
    references: {
      table: string;
      columns: string[];
    };
    name?: string | undefined;
  }>;
}

export interface PrismaStorageTypeInstance {
  codecId: string;
  nativeType: string;
  typeParams: Record<string, unknown>;
}

export interface PrismaRelationDefinition {
  to: string;
  cardinality: '1:1' | '1:N' | 'N:1' | 'N:M';
  on: {
    parentCols: string[];
    childCols: string[];
  };
  through?:
    | {
        table: string;
        parentCols: string[];
        childCols: string[];
      }
    | undefined;
}

export interface PrismaExecutionDefault {
  ref: {
    table: string;
    column: string;
  };
  onCreate?:
    | {
        kind: 'generator';
        id: 'ulid' | 'nanoid' | 'uuidv7' | 'uuidv4' | 'cuid2' | 'ksuid';
        params?: Record<string, unknown> | undefined;
      }
    | undefined;
  onUpdate?:
    | {
        kind: 'generator';
        id: 'ulid' | 'nanoid' | 'uuidv7' | 'uuidv4' | 'cuid2' | 'ksuid';
        params?: Record<string, unknown> | undefined;
      }
    | undefined;
}

export interface PrismaContractIR {
  schemaVersion: '1';
  target: 'postgres';
  targetFamily: 'sql';
  storageHash: string;
  models: Record<
    string,
    {
      storage: {
        table: string;
      };
      fields: Record<
        string,
        {
          column: string;
        }
      >;
      relations: Record<string, PrismaRelationDefinition>;
    }
  >;
  relations: Record<string, Record<string, PrismaRelationDefinition>>;
  storage: {
    tables: Record<string, PrismaContractTable>;
    types?: Record<string, PrismaStorageTypeInstance> | undefined;
  };
  execution?:
    | {
        mutations: {
          defaults: PrismaExecutionDefault[];
        };
      }
    | undefined;
  extensionPacks: Record<string, unknown>;
  capabilities: Record<string, Record<string, boolean>>;
  meta: Record<string, unknown>;
  sources: Record<string, unknown>;
}

export interface LoadedPrismaSchemaSource {
  schemaPath: string;
  schema: string;
  sanitizedSchema: string;
}

export interface ConvertPrismaSchemaOptions {
  schemaPath?: string | undefined;
  schema?: string | undefined;
}

export interface ConvertPrismaSchemaResult {
  contract: PrismaContractIR;
  provider: string;
  missingFeatures: string[];
  sanitizedSchema: string;
}
