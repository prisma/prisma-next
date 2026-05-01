import type { ControlTargetDescriptor } from './control-descriptors';
import type { ControlFamilyInstance } from './control-instances';
import type { MigrationPlanOperation, TargetMigrationsCapability } from './control-migration-types';
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
