import type { SchemaDiffIssue } from './schema-diff';

export const VERIFY_CODE_MARKER_MISSING = 'PN-RUN-3001';
export const VERIFY_CODE_HASH_MISMATCH = 'PN-RUN-3002';
export const VERIFY_CODE_TARGET_MISMATCH = 'PN-RUN-3003';
export const VERIFY_CODE_SCHEMA_FAILURE = 'PN-RUN-3010';

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

export interface BaseSchemaIssue {
  readonly kind:
    | 'missing_schema'
    | 'missing_table'
    | 'missing_column'
    | 'extra_table'
    | 'extra_column'
    | 'extra_primary_key'
    | 'extra_foreign_key'
    | 'extra_unique_constraint'
    | 'extra_index'
    | 'extra_validator'
    | 'type_mismatch'
    | 'type_missing'
    | 'type_values_mismatch'
    | 'nullability_mismatch'
    | 'primary_key_mismatch'
    | 'foreign_key_mismatch'
    | 'unique_constraint_mismatch'
    | 'index_mismatch'
    | 'default_missing'
    | 'default_mismatch'
    | 'extra_default'
    | 'check_missing'
    | 'check_removed'
    | 'check_mismatch';
  readonly table?: string;
  /**
   * Namespace coordinate of the issue's subject (e.g. the schema a SQL
   * table lives in). Populated by family verifiers that have the
   * coordinate in scope when constructing the issue; absent for issues
   * whose family has no namespace concept (e.g. Mongo collections) or
   * whose subject isn't in any contract namespace (e.g. an extra-table
   * issue raised for a table that exists in the live DB but not in the
   * contract).
   *
   * Downstream planners trust this field as the authoritative subject
   * coordinate and do not re-derive it by name lookup. A finer-grained
   * structural split between framework-shared and family-specific issue
   * fields is tracked under a follow-up ticket.
   */
  readonly namespaceId?: string;
  readonly column?: string;
  readonly indexOrConstraint?: string;
  readonly typeName?: string;
  readonly expected?: string;
  readonly actual?: string;
  readonly message: string;
}

export interface EnumValuesChangedIssue {
  readonly kind: 'enum_values_changed';
  /**
   * Namespace coordinate of the enum type that changed values. Populated by
   * family verifiers that have the coordinate in scope when constructing the
   * issue. Downstream planners trust this field as the authoritative subject
   * coordinate and do not re-derive it by name lookup.
   */
  readonly namespaceId: string;
  readonly typeName: string;
  readonly addedValues: readonly string[];
  readonly removedValues: readonly string[];
  readonly message: string;
}

export type SchemaIssue = BaseSchemaIssue | EnumValuesChangedIssue;

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
    /** Schema-diff issues (e.g. RLS policy drift) contributed by the target adapter. */
    readonly schemaDiffIssues: readonly SchemaDiffIssue[];
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
