import type {
  AdapterDescriptor,
  AdapterInstance,
  DriverDescriptor,
  DriverInstance,
  ExtensionDescriptor,
  ExtensionInstance,
  FamilyDescriptor,
  FamilyInstance,
  TargetBoundComponentDescriptor,
  TargetDescriptor,
  TargetInstance,
} from '@prisma-next/contract/framework-components';
import type { ContractIR } from '@prisma-next/contract/ir';
import type { ContractMarkerRecord, TargetFamilyHook } from '@prisma-next/contract/types';

export type SchemaNodeKind =
  | 'root'
  | 'namespace'
  | 'collection'
  | 'entity'
  | 'field'
  | 'index'
  | 'extension';

export interface SchemaTreeNode {
  readonly kind: SchemaNodeKind;
  readonly id: string;
  readonly label: string;
  readonly meta?: Record<string, unknown>;
  readonly children?: readonly SchemaTreeNode[];
}

export interface CoreSchemaView {
  readonly root: SchemaTreeNode;
}

export interface ControlFamilyInstance<TFamilyId extends string, TSchemaIR = unknown>
  extends FamilyInstance<TFamilyId> {
  validateContractIR(contractJson: unknown): ContractIR;

  verify(options: {
    readonly driver: ControlDriverInstance<TFamilyId, string>;
    readonly contractIR: unknown;
    readonly expectedTargetId: string;
    readonly contractPath: string;
    readonly configPath?: string;
  }): Promise<VerifyDatabaseResult>;

  schemaVerify(options: {
    readonly driver: ControlDriverInstance<TFamilyId, string>;
    readonly contractIR: unknown;
    readonly strict: boolean;
    readonly contractPath: string;
    readonly configPath?: string;
    readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<TFamilyId, string>>;
  }): Promise<VerifyDatabaseSchemaResult>;

  sign(options: {
    readonly driver: ControlDriverInstance<TFamilyId, string>;
    readonly contractIR: unknown;
    readonly contractPath: string;
    readonly configPath?: string;
  }): Promise<SignDatabaseResult>;

  readMarker(options: {
    readonly driver: ControlDriverInstance<TFamilyId, string>;
  }): Promise<ContractMarkerRecord | null>;

  introspect(options: {
    readonly driver: ControlDriverInstance<TFamilyId, string>;
    readonly contractIR?: unknown;
  }): Promise<TSchemaIR>;

  toSchemaView?(schema: TSchemaIR): CoreSchemaView;

  emitContract(options: { readonly contractIR: ContractIR | unknown }): Promise<EmitContractResult>;
}

export interface ControlTargetInstance<TFamilyId extends string, TTargetId extends string>
  extends TargetInstance<TFamilyId, TTargetId> {}

export interface ControlAdapterInstance<TFamilyId extends string, TTargetId extends string>
  extends AdapterInstance<TFamilyId, TTargetId> {}

export interface ControlDriverInstance<TFamilyId extends string, TTargetId extends string>
  extends DriverInstance<TFamilyId, TTargetId> {
  query<Row = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ readonly rows: Row[] }>;
  close(): Promise<void>;
}

export interface ControlExtensionInstance<TFamilyId extends string, TTargetId extends string>
  extends ExtensionInstance<TFamilyId, TTargetId> {}

export interface ControlPlaneStack<TFamilyId extends string, TTargetId extends string> {
  readonly target: ControlTargetDescriptor<TFamilyId, TTargetId>;
  readonly adapter: ControlAdapterDescriptor<TFamilyId, TTargetId>;
  readonly driver: ControlDriverDescriptor<TFamilyId, TTargetId> | undefined;
  readonly extensionPacks: readonly ControlExtensionDescriptor<TFamilyId, TTargetId>[];
}

export interface ControlFamilyDescriptor<
  TFamilyId extends string,
  TFamilyInstance extends ControlFamilyInstance<TFamilyId> = ControlFamilyInstance<TFamilyId>,
> extends FamilyDescriptor<TFamilyId> {
  readonly hook: TargetFamilyHook;
  create<TTargetId extends string>(stack: ControlPlaneStack<TFamilyId, TTargetId>): TFamilyInstance;
}

export interface ControlTargetDescriptor<
  TFamilyId extends string,
  TTargetId extends string,
  TTargetInstance extends ControlTargetInstance<TFamilyId, TTargetId> = ControlTargetInstance<
    TFamilyId,
    TTargetId
  >,
> extends TargetDescriptor<TFamilyId, TTargetId> {
  create(): TTargetInstance;
}

export interface ControlAdapterDescriptor<
  TFamilyId extends string,
  TTargetId extends string,
  TAdapterInstance extends ControlAdapterInstance<TFamilyId, TTargetId> = ControlAdapterInstance<
    TFamilyId,
    TTargetId
  >,
> extends AdapterDescriptor<TFamilyId, TTargetId> {
  create(): TAdapterInstance;
}

export interface ControlDriverDescriptor<
  TFamilyId extends string,
  TTargetId extends string,
  TDriverInstance extends ControlDriverInstance<TFamilyId, TTargetId> = ControlDriverInstance<
    TFamilyId,
    TTargetId
  >,
  TConnection = string,
> extends DriverDescriptor<TFamilyId, TTargetId> {
  create(connection: TConnection): Promise<TDriverInstance>;
}

export interface ControlExtensionDescriptor<
  TFamilyId extends string,
  TTargetId extends string,
  TExtensionInstance extends ControlExtensionInstance<
    TFamilyId,
    TTargetId
  > = ControlExtensionInstance<TFamilyId, TTargetId>,
> extends ExtensionDescriptor<TFamilyId, TTargetId> {
  create(): TExtensionInstance;
}

export interface OperationContext {
  readonly contractPath?: string;
  readonly configPath?: string;
  readonly meta?: Readonly<Record<string, unknown>>;
}

export interface VerifyDatabaseResult {
  readonly ok: boolean;
  readonly code?: string;
  readonly summary: string;
  readonly contract: {
    readonly storageHash: string;
    readonly profileHash?: string;
  };
  readonly marker?: {
    readonly storageHash?: string;
    readonly profileHash?: string;
  };
  readonly target: {
    readonly expected: string;
    readonly actual?: string;
  };
  readonly missingCodecs?: readonly string[];
  readonly codecCoverageSkipped?: boolean;
  readonly meta?: {
    readonly configPath?: string;
    readonly contractPath: string;
  };
  readonly timings: {
    readonly total: number;
  };
}

export interface SchemaIssue {
  readonly kind:
    | 'missing_table'
    | 'missing_column'
    | 'extra_table'
    | 'extra_column'
    | 'extra_primary_key'
    | 'extra_foreign_key'
    | 'extra_unique_constraint'
    | 'extra_index'
    | 'type_mismatch'
    | 'type_missing'
    | 'type_values_mismatch'
    | 'nullability_mismatch'
    | 'primary_key_mismatch'
    | 'foreign_key_mismatch'
    | 'unique_constraint_mismatch'
    | 'index_mismatch'
    | 'extension_missing'
    | 'default_missing'
    | 'default_mismatch';
  readonly table: string;
  readonly column?: string;
  readonly indexOrConstraint?: string;
  readonly typeName?: string;
  readonly expected?: string;
  readonly actual?: string;
  readonly message: string;
}

export interface SchemaVerificationNode {
  readonly status: 'pass' | 'warn' | 'fail';
  readonly kind: string;
  readonly name: string;
  readonly contractPath: string;
  readonly code: string;
  readonly message: string;
  readonly expected: unknown;
  readonly actual: unknown;
  readonly children: readonly SchemaVerificationNode[];
}

export interface VerifyDatabaseSchemaResult {
  readonly ok: boolean;
  readonly code?: string;
  readonly summary: string;
  readonly contract: {
    readonly storageHash: string;
    readonly profileHash?: string;
  };
  readonly target: {
    readonly expected: string;
    readonly actual?: string;
  };
  readonly schema: {
    readonly issues: readonly SchemaIssue[];
    readonly root: SchemaVerificationNode;
    readonly counts: {
      readonly pass: number;
      readonly warn: number;
      readonly fail: number;
      readonly totalNodes: number;
    };
  };
  readonly meta?: {
    readonly configPath?: string;
    readonly contractPath?: string;
    readonly strict: boolean;
  };
  readonly timings: {
    readonly total: number;
  };
}

export interface EmitContractResult {
  readonly contractJson: string;
  readonly contractDts: string;
  readonly storageHash: string;
  readonly executionHash?: string;
  readonly profileHash: string;
}

export interface IntrospectSchemaResult<TSchemaIR> {
  readonly ok: true;
  readonly summary: string;
  readonly target: {
    readonly familyId: string;
    readonly id: string;
  };
  readonly schema: TSchemaIR;
  readonly meta?: {
    readonly configPath?: string;
    readonly dbUrl?: string;
  };
  readonly timings: {
    readonly total: number;
  };
}

export interface SignDatabaseResult {
  readonly ok: boolean;
  readonly summary: string;
  readonly contract: {
    readonly storageHash: string;
    readonly profileHash?: string;
  };
  readonly target: {
    readonly expected: string;
    readonly actual?: string;
  };
  readonly marker: {
    readonly created: boolean;
    readonly updated: boolean;
    readonly previous?: {
      readonly storageHash?: string;
      readonly profileHash?: string;
    };
  };
  readonly meta?: {
    readonly configPath?: string;
    readonly contractPath: string;
  };
  readonly timings: {
    readonly total: number;
  };
}
