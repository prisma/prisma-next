import { errorUnexpected } from '../errors';
import type {
  AdapterDescriptor,
  ControlPlaneDriver,
  ExtensionDescriptor,
  FamilyDescriptor,
  TargetDescriptor,
} from '../types';

export interface IntrospectDatabaseSchemaOptions<TSchemaIR = unknown> {
  readonly driver: ControlPlaneDriver;
  readonly family: FamilyDescriptor<TSchemaIR>;
  readonly target: TargetDescriptor;
  readonly adapter: AdapterDescriptor;
  readonly extensions: ReadonlyArray<ExtensionDescriptor>;
  readonly codecRegistry: unknown; // Family-specific registry type (e.g., CodecRegistry for SQL)
}

export interface IntrospectDatabaseSchemaResult<TSchemaIR = unknown> {
  readonly schemaIR: TSchemaIR;
}

/**
 * Introspects the database schema and returns a Schema IR.
 * This is a domain action that orchestrates the family's introspectSchema hook.
 * The codecRegistry is pre-assembled by the caller (CLI/domain).
 */
export async function introspectDatabaseSchema<TSchemaIR = unknown>(
  options: IntrospectDatabaseSchemaOptions<TSchemaIR>,
): Promise<IntrospectDatabaseSchemaResult<TSchemaIR>> {
  const { driver, family, target, adapter, extensions, codecRegistry } = options;

  if (!family.verify?.introspectSchema) {
    throw errorUnexpected('Family introspectSchema() is required', {
      why: 'Family verify.introspectSchema is required for schema verification',
    });
  }

  const schemaIR = await family.verify.introspectSchema({
    driver,
    codecRegistry,
    target,
    adapter,
    extensions,
  });

  return { schemaIR };
}
