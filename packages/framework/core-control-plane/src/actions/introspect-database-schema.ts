import { errorUnexpected } from '../errors';
import type {
  AdapterDescriptor,
  ControlPlaneDriver,
  ExtensionDescriptor,
  FamilyDescriptor,
  TargetDescriptor,
  TargetFamilyContext,
} from '../types';

export interface IntrospectDatabaseSchemaOptions<
  TCtx extends TargetFamilyContext = TargetFamilyContext,
> {
  readonly driver: ControlPlaneDriver;
  readonly family: FamilyDescriptor<TCtx>;
  readonly target: TargetDescriptor<TCtx>;
  readonly adapter: AdapterDescriptor<TCtx>;
  readonly extensions: ReadonlyArray<ExtensionDescriptor<TCtx>>;
  readonly contextInput: Omit<TCtx, 'schemaIR'>;
}

export interface IntrospectDatabaseSchemaResult<
  TCtx extends TargetFamilyContext = TargetFamilyContext,
> {
  readonly schemaIR: TCtx['schemaIR'];
}

/**
 * Introspects the database schema and returns a Schema IR.
 * This is a domain action that orchestrates the family's introspectSchema hook.
 * The contextInput contains family-specific control-plane state (e.g., codecRegistry for SQL).
 */
export async function introspectDatabaseSchema<
  TCtx extends TargetFamilyContext = TargetFamilyContext,
>(options: IntrospectDatabaseSchemaOptions<TCtx>): Promise<IntrospectDatabaseSchemaResult<TCtx>> {
  const { driver, family, target, adapter, extensions, contextInput } = options;

  if (!family.verify?.introspectSchema) {
    throw errorUnexpected('Family introspectSchema() is required', {
      why: 'Family verify.introspectSchema is required for schema verification',
    });
  }

  const schemaIR = await family.verify.introspectSchema({
    driver,
    contextInput,
    target,
    adapter,
    extensions,
  });

  return { schemaIR };
}
