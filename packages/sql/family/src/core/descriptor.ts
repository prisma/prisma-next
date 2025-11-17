import type { ExtensionPackManifest } from '@prisma-next/core-control-plane/pack-manifest-types';
import type {
  AdapterDescriptor,
  ExtensionDescriptor,
  FamilyDescriptor,
  TargetDescriptor,
} from '@prisma-next/core-control-plane/types';
import { sqlTargetFamilyHook } from '@prisma-next/sql-contract-emitter';
import { createSqlFamilyInstance, type SqlFamilyInstance } from './instance';

/**
 * SQL family manifest.
 */
const sqlFamilyManifest: ExtensionPackManifest = {
  id: 'sql',
  version: '0.0.1',
};

/**
 * SQL family descriptor implementation.
 * Provides the SQL family hook and factory method.
 */
export class SqlFamilyDescriptor implements FamilyDescriptor<'sql', SqlFamilyInstance> {
  readonly kind = 'family' as const;
  readonly familyId = 'sql' as const;
  readonly manifest = sqlFamilyManifest;
  readonly hook = sqlTargetFamilyHook;

  create(options: {
    readonly target: TargetDescriptor<'sql'>;
    readonly adapter: AdapterDescriptor<'sql'>;
    readonly extensions: ReadonlyArray<ExtensionDescriptor<'sql'>>;
  }): SqlFamilyInstance {
    return createSqlFamilyInstance(options);
  }
}
