import type { TargetBoundComponentDescriptor } from '@prisma-next/contract/framework-components';
import type {
  ControlAdapterDescriptor,
  ControlDriverInstance,
  ControlExtensionDescriptor,
  ControlTargetDescriptor,
  ControlTargetInstance,
  MigrationOperationPolicy,
  MigrationPlan,
  MigrationPlannerConflict,
  MigrationPlannerFailureResult,
  MigrationPlannerSuccessResult,
  MigrationPlanOperation,
  MigrationRunnerExecutionChecks,
  MigrationRunnerFailure,
  MigrationRunnerSuccessValue,
  OperationContext,
  SchemaIssue,
} from '@prisma-next/core-control-plane/types';
import type { SqlContract, SqlStorage, StorageTypeInstance } from '@prisma-next/sql-contract/types';
import type { SqlOperationSignature } from '@prisma-next/sql-operations';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import type { Result } from '@prisma-next/utils/result';
import type { SqlControlFamilyInstance } from '../control-instance';

export type AnyRecord = Readonly<Record<string, unknown>>;

type ControlMutationDefaultSpan = {
  readonly start: {
    readonly offset: number;
    readonly line: number;
    readonly column: number;
  };
  readonly end: {
    readonly offset: number;
    readonly line: number;
    readonly column: number;
  };
};

type ControlMutationDefaultFunctionCall = {
  readonly name: string;
  readonly raw: string;
  readonly args: readonly {
    readonly raw: string;
    readonly span: ControlMutationDefaultSpan;
  }[];
  readonly span: ControlMutationDefaultSpan;
};

type ControlMutationDefaultLoweringContext = {
  readonly sourceId: string;
  readonly modelName: string;
  readonly fieldName: string;
  readonly columnCodecId?: string;
};

export type ControlMutationDefaultFunctionHandler = (input: {
  readonly call: ControlMutationDefaultFunctionCall;
  readonly context: ControlMutationDefaultLoweringContext;
}) => unknown;

export interface ControlMutationDefaultFunctionEntry {
  readonly lower: ControlMutationDefaultFunctionHandler;
  readonly usageSignatures?: readonly string[];
}

export interface ControlMutationDefaultGeneratorDescriptor {
  readonly id: string;
  readonly applicableCodecIds: readonly string[];
  readonly resolveGeneratedColumnDescriptor?: (input: {
    readonly generated: {
      readonly kind: string;
      readonly id: string;
      readonly params?: Record<string, unknown>;
    };
  }) =>
    | {
        readonly codecId: string;
        readonly nativeType: string;
        readonly typeRef?: string;
        readonly typeParams?: Record<string, unknown>;
      }
    | undefined;
}

export interface PslScalarTypeDescriptor {
  readonly codecId: string;
  readonly nativeType: string;
  readonly typeRef?: string;
  readonly typeParams?: Record<string, unknown>;
}

export interface SqlControlStaticContributions {
  readonly operationSignatures: () => ReadonlyArray<SqlOperationSignature>;
  readonly controlMutationDefaults?: () => {
    readonly defaultFunctionRegistry: ReadonlyMap<string, ControlMutationDefaultFunctionEntry>;
    readonly generatorDescriptors: ReadonlyArray<ControlMutationDefaultGeneratorDescriptor>;
  };
  readonly pslTypeDescriptors?: () => {
    readonly scalarTypeDescriptors: ReadonlyMap<string, PslScalarTypeDescriptor>;
  };
}

export interface ComponentDatabaseDependency<TTargetDetails> {
  readonly id: string;
  readonly label: string;
  readonly install: readonly SqlMigrationPlanOperation<TTargetDetails>[];
}

export interface ComponentDatabaseDependencies<TTargetDetails> {
  readonly init?: readonly ComponentDatabaseDependency<TTargetDetails>[];
}

export interface DatabaseDependencyProvider {
  readonly databaseDependencies?: ComponentDatabaseDependencies<unknown>;
}

export function isDatabaseDependencyProvider(value: unknown): value is DatabaseDependencyProvider {
  return typeof value === 'object' && value !== null && 'databaseDependencies' in value;
}

export function collectInitDependencies(
  components: ReadonlyArray<unknown>,
): readonly ComponentDatabaseDependency<unknown>[] {
  const result: ComponentDatabaseDependency<unknown>[] = [];
  for (const component of components) {
    if (!isDatabaseDependencyProvider(component)) continue;
    const deps = component.databaseDependencies?.init;
    if (!deps) continue;
    result.push(...deps);
  }
  return result;
}

export interface StorageTypePlanResult<TTargetDetails> {
  readonly operations: readonly SqlMigrationPlanOperation<TTargetDetails>[];
}

/**
 * Input for expanding parameterized native types.
 */
export interface ExpandNativeTypeInput {
  readonly nativeType: string;
  readonly codecId?: string;
  readonly typeParams?: Record<string, unknown>;
}

export interface CodecControlHooks<TTargetDetails = unknown> {
  planTypeOperations?: (options: {
    readonly typeName: string;
    readonly typeInstance: StorageTypeInstance;
    readonly contract: SqlContract<SqlStorage>;
    readonly schema: SqlSchemaIR;
    readonly schemaName?: string;
    readonly policy: MigrationOperationPolicy;
  }) => StorageTypePlanResult<TTargetDetails>;
  verifyType?: (options: {
    readonly typeName: string;
    readonly typeInstance: StorageTypeInstance;
    readonly schema: SqlSchemaIR;
    readonly schemaName?: string;
  }) => readonly SchemaIssue[];
  introspectTypes?: (options: {
    readonly driver: ControlDriverInstance<'sql', string>;
    readonly schemaName?: string;
  }) => Promise<Record<string, StorageTypeInstance>>;
  /**
   * Expands a parameterized native type to its full SQL representation.
   * Used by schema verification to compare contract types against database types.
   *
   * For example, expands:
   * - { nativeType: 'character varying', typeParams: { length: 255 } } -> 'character varying(255)'
   * - { nativeType: 'numeric', typeParams: { precision: 10, scale: 2 } } -> 'numeric(10,2)'
   *
   * Returns the expanded type string, or the original nativeType if no expansion is needed.
   */
  expandNativeType?: (input: ExpandNativeTypeInput) => string;
}

export interface SqlControlExtensionDescriptor<TTargetId extends string>
  extends ControlExtensionDescriptor<'sql', TTargetId>,
    SqlControlStaticContributions {
  readonly databaseDependencies?: ComponentDatabaseDependencies<unknown>;
}

export interface SqlControlAdapterDescriptor<TTargetId extends string>
  extends ControlAdapterDescriptor<'sql', TTargetId>,
    SqlControlStaticContributions {}

export interface SqlMigrationPlanOperationStep {
  readonly description: string;
  readonly sql: string;
  readonly meta?: AnyRecord;
}

export interface SqlMigrationPlanOperationTarget<TTargetDetails> {
  readonly id: string;
  readonly details?: TTargetDetails;
}

export interface SqlMigrationPlanOperation<TTargetDetails> extends MigrationPlanOperation {
  readonly summary?: string;
  readonly target: SqlMigrationPlanOperationTarget<TTargetDetails>;
  readonly precheck: readonly SqlMigrationPlanOperationStep[];
  readonly execute: readonly SqlMigrationPlanOperationStep[];
  readonly postcheck: readonly SqlMigrationPlanOperationStep[];
  readonly meta?: AnyRecord;
}

export interface SqlMigrationPlanContractInfo {
  readonly storageHash: string;
  readonly profileHash?: string;
}

export interface SqlMigrationPlan<TTargetDetails> extends MigrationPlan {
  /**
   * Origin contract identity that the plan expects the database to currently be at.
   * If omitted or null, the runner skips origin validation entirely.
   */
  readonly origin?: SqlMigrationPlanContractInfo | null;
  /**
   * Destination contract identity that the plan intends to reach.
   */
  readonly destination: SqlMigrationPlanContractInfo;
  readonly operations: readonly SqlMigrationPlanOperation<TTargetDetails>[];
  readonly meta?: AnyRecord;
}

export type SqlPlannerConflictKind =
  | 'typeMismatch'
  | 'nullabilityConflict'
  | 'indexIncompatible'
  | 'foreignKeyConflict'
  | 'missingButNonAdditive'
  | 'unsupportedOperation';

export interface SqlPlannerConflictLocation {
  readonly table?: string;
  readonly column?: string;
  readonly index?: string;
  readonly constraint?: string;
  readonly type?: string;
}

export interface SqlPlannerConflict extends MigrationPlannerConflict {
  readonly kind: SqlPlannerConflictKind;
  readonly location?: SqlPlannerConflictLocation;
  readonly meta?: AnyRecord;
}

export interface SqlPlannerSuccessResult<TTargetDetails>
  extends Omit<MigrationPlannerSuccessResult, 'plan'> {
  readonly kind: 'success';
  readonly plan: SqlMigrationPlan<TTargetDetails>;
}

export interface SqlPlannerFailureResult extends Omit<MigrationPlannerFailureResult, 'conflicts'> {
  readonly kind: 'failure';
  readonly conflicts: readonly SqlPlannerConflict[];
}

export type SqlPlannerResult<TTargetDetails> =
  | SqlPlannerSuccessResult<TTargetDetails>
  | SqlPlannerFailureResult;

export interface SqlMigrationPlannerPlanOptions {
  readonly contract: SqlContract<SqlStorage>;
  readonly schema: SqlSchemaIR;
  readonly policy: MigrationOperationPolicy;
  readonly schemaName?: string;
  /**
   * Active framework components participating in this composition.
   * SQL targets can interpret this list to derive database dependencies.
   * All components must have matching familyId ('sql') and targetId.
   */
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>;
}

export interface SqlMigrationPlanner<TTargetDetails> {
  plan(options: SqlMigrationPlannerPlanOptions): SqlPlannerResult<TTargetDetails>;
}

export interface SqlMigrationRunnerExecuteCallbacks<TTargetDetails> {
  onOperationStart?(operation: SqlMigrationPlanOperation<TTargetDetails>): void;
  onOperationComplete?(operation: SqlMigrationPlanOperation<TTargetDetails>): void;
}

export interface SqlMigrationRunnerExecuteOptions<TTargetDetails> {
  readonly plan: SqlMigrationPlan<TTargetDetails>;
  readonly driver: ControlDriverInstance<'sql', string>;
  /**
   * Destination contract IR.
   * Must correspond to `plan.destination` and is used for schema verification and marker/ledger writes.
   */
  readonly destinationContract: SqlContract<SqlStorage>;
  /**
   * Execution-time policy that defines which operation classes are allowed.
   * The runner validates each operation against this policy before execution.
   */
  readonly policy: MigrationOperationPolicy;
  readonly schemaName?: string;
  readonly strictVerification?: boolean;
  readonly callbacks?: SqlMigrationRunnerExecuteCallbacks<TTargetDetails>;
  readonly context?: OperationContext;
  /**
   * Execution-time checks configuration.
   * All checks default to `true` (enabled) when omitted.
   */
  readonly executionChecks?: MigrationRunnerExecutionChecks;
  /**
   * Active framework components participating in this composition.
   * SQL targets can interpret this list to derive database dependencies.
   * All components must have matching familyId ('sql') and targetId.
   */
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>;
}

export type SqlMigrationRunnerErrorCode =
  | 'DESTINATION_CONTRACT_MISMATCH'
  | 'MARKER_ORIGIN_MISMATCH'
  | 'POLICY_VIOLATION'
  | 'PRECHECK_FAILED'
  | 'POSTCHECK_FAILED'
  | 'SCHEMA_VERIFY_FAILED'
  | 'EXECUTION_FAILED';

export interface SqlMigrationRunnerFailure extends MigrationRunnerFailure {
  readonly code: SqlMigrationRunnerErrorCode;
  readonly meta?: AnyRecord;
}

export interface SqlMigrationRunnerSuccessValue extends MigrationRunnerSuccessValue {}

export type SqlMigrationRunnerResult = Result<
  SqlMigrationRunnerSuccessValue,
  SqlMigrationRunnerFailure
>;

export interface SqlMigrationRunner<TTargetDetails> {
  execute(
    options: SqlMigrationRunnerExecuteOptions<TTargetDetails>,
  ): Promise<SqlMigrationRunnerResult>;
}

export interface SqlControlTargetDescriptor<TTargetId extends string, TTargetDetails>
  extends ControlTargetDescriptor<
      'sql',
      TTargetId,
      ControlTargetInstance<'sql', TTargetId>,
      SqlControlFamilyInstance
    >,
    SqlControlStaticContributions {
  createPlanner(family: SqlControlFamilyInstance): SqlMigrationPlanner<TTargetDetails>;
  createRunner(family: SqlControlFamilyInstance): SqlMigrationRunner<TTargetDetails>;
}

export interface CreateSqlMigrationPlanOptions<TTargetDetails> {
  readonly targetId: string;
  readonly origin?: SqlMigrationPlanContractInfo | null;
  readonly destination: SqlMigrationPlanContractInfo;
  readonly operations: readonly SqlMigrationPlanOperation<TTargetDetails>[];
  readonly meta?: AnyRecord;
}
