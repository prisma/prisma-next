import type { ControlTargetDescriptor } from './control-descriptors';
import type { ControlFamilyInstance } from './control-instances';
import type { TargetMigrationsCapability } from './control-migration-types';
import type { CoreSchemaView } from './control-schema-view';

export interface MigratableTargetDescriptor<
  TFamilyId extends string,
  TTargetId extends string,
  TFamilyInstance extends ControlFamilyInstance<TFamilyId> = ControlFamilyInstance<TFamilyId>,
> extends ControlTargetDescriptor<TFamilyId, TTargetId> {
  readonly migrations: TargetMigrationsCapability<TFamilyId, TTargetId, TFamilyInstance>;
}

export function hasMigrations<TFamilyId extends string, TTargetId extends string>(
  target: ControlTargetDescriptor<TFamilyId, TTargetId>,
): target is MigratableTargetDescriptor<TFamilyId, TTargetId> {
  return 'migrations' in target && !!(target as Record<string, unknown>)['migrations'];
}

export interface SchemaViewCapable {
  toSchemaView(schema: unknown): CoreSchemaView;
}

export function hasSchemaView<TFamilyId extends string, TSchemaIR>(
  instance: ControlFamilyInstance<TFamilyId, TSchemaIR>,
): instance is ControlFamilyInstance<TFamilyId, TSchemaIR> & SchemaViewCapable {
  return (
    'toSchemaView' in instance &&
    typeof (instance as Record<string, unknown>)['toSchemaView'] === 'function'
  );
}
