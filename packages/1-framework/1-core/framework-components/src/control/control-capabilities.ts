import type { ControlTargetDescriptor } from './control-descriptors';
import type { ControlFamilyInstance } from './control-instances';
import type {
  MigrationPlanOperation,
  MigrationRunner,
  MultiSpaceCapableRunner,
  TargetMigrationsCapability,
} from './control-migration-types';
import type { OperationPreview } from './control-operation-preview';
import type { CoreSchemaView } from './control-schema-view';
import type { PslDocumentAst } from './psl-ast';

export interface MigratableTargetDescriptor<
  TFamilyId extends string,
  TTargetId extends string,
  TFamilyInstance extends ControlFamilyInstance<TFamilyId, unknown> = ControlFamilyInstance<
    TFamilyId,
    unknown
  >,
> extends ControlTargetDescriptor<TFamilyId, TTargetId> {
  readonly migrations: TargetMigrationsCapability<TFamilyId, TTargetId, TFamilyInstance>;
}

export function hasMigrations<TFamilyId extends string, TTargetId extends string>(
  target: ControlTargetDescriptor<TFamilyId, TTargetId>,
): target is MigratableTargetDescriptor<TFamilyId, TTargetId> {
  return 'migrations' in target && !!(target as Record<string, unknown>)['migrations'];
}

export interface SchemaViewCapable<TSchemaIR = unknown> {
  toSchemaView(schema: TSchemaIR): CoreSchemaView;
}

export function hasSchemaView<TFamilyId extends string, TSchemaIR>(
  instance: ControlFamilyInstance<TFamilyId, TSchemaIR>,
): instance is ControlFamilyInstance<TFamilyId, TSchemaIR> & SchemaViewCapable<TSchemaIR> {
  return (
    'toSchemaView' in instance &&
    typeof (instance as Record<string, unknown>)['toSchemaView'] === 'function'
  );
}

/**
 * Capability declaring that a family can infer a PSL contract AST from its
 * opaque introspected schema IR. Consumed by `prisma-next contract infer`.
 */
export interface PslContractInferCapable<TSchemaIR = unknown> {
  inferPslContract(schemaIR: TSchemaIR): PslDocumentAst;
}

export function hasPslContractInfer<TFamilyId extends string, TSchemaIR>(
  instance: ControlFamilyInstance<TFamilyId, TSchemaIR>,
): instance is ControlFamilyInstance<TFamilyId, TSchemaIR> & PslContractInferCapable<TSchemaIR> {
  return (
    'inferPslContract' in instance &&
    typeof (instance as Record<string, unknown>)['inferPslContract'] === 'function'
  );
}

/**
 * Capability declaring that a family can render a textual preview of migration
 * operations for the CLI's "DDL preview" output. SQL families emit
 * `language: 'sql'` statements; Mongo families emit `language: 'mongodb-shell'`.
 */
export interface OperationPreviewCapable {
  toOperationPreview(operations: readonly MigrationPlanOperation[]): OperationPreview;
}

export function hasOperationPreview<TFamilyId extends string, TSchemaIR>(
  instance: ControlFamilyInstance<TFamilyId, TSchemaIR>,
): instance is ControlFamilyInstance<TFamilyId, TSchemaIR> & OperationPreviewCapable {
  return (
    'toOperationPreview' in instance &&
    typeof (instance as Record<string, unknown>)['toOperationPreview'] === 'function'
  );
}

/**
 * Capability declaring that a runner can apply per-space plans inside a
 * single outer transaction. Today's only implementer is the SQL family
 * (`SqlMigrationRunner`); Mongo per-space is a non-goal per the project
 * spec for extension contract spaces (TML-2397).
 *
 * The CLI uses this guard to route `db init` / `db update` through a
 * per-space wiring when extensions expose a `contractSpace`, falling back
 * to the single-space path when no multi-space capability is present.
 */
export function hasMultiSpaceRunner<TFamilyId extends string, TTargetId extends string>(
  runner: MigrationRunner<TFamilyId, TTargetId>,
): runner is MigrationRunner<TFamilyId, TTargetId> & MultiSpaceCapableRunner<TFamilyId, TTargetId> {
  return (
    'executeAcrossSpaces' in runner &&
    typeof (runner as Record<string, unknown>)['executeAcrossSpaces'] === 'function'
  );
}
