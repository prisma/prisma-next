import type { ExtensionPackManifest } from '@prisma-next/core-control-plane/pack-manifest-types';
import type {
  AdapterDescriptor,
  ControlAdapterDescriptor,
  ControlDriverDescriptor,
  ControlExtensionDescriptor,
  ControlFamilyDescriptor,
  ControlTargetDescriptor,
  ExtensionDescriptor,
  FamilyDescriptor,
  TargetDescriptor,
} from '@prisma-next/core-control-plane/types';
import { sqlTargetFamilyHook } from '@prisma-next/sql-contract-emitter';
import {
  createSqlFamilyInstance,
  type SqlControlFamilyInstance,
  type SqlFamilyInstance,
} from './instance';

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
 * Implements both legacy FamilyDescriptor and new ControlFamilyDescriptor for backward compatibility.
 */
export class SqlFamilyDescriptor
  implements
    FamilyDescriptor<'sql', SqlFamilyInstance>,
    ControlFamilyDescriptor<'sql', SqlControlFamilyInstance>
{
  readonly kind = 'family' as const;
  readonly id = 'sql';
  readonly familyId = 'sql' as const;
  readonly manifest = sqlFamilyManifest;
  readonly hook = sqlTargetFamilyHook;

  // Legacy create method (for backward compatibility)
  create(options: {
    readonly target: TargetDescriptor<'sql'>;
    readonly adapter: AdapterDescriptor<'sql'>;
    readonly extensions: ReadonlyArray<ExtensionDescriptor<'sql'>>;
  }): SqlFamilyInstance;

  // New create method with Control* descriptors
  create<TTargetId extends string>(options: {
    readonly target: ControlTargetDescriptor<'sql', TTargetId>;
    readonly adapter: ControlAdapterDescriptor<'sql', TTargetId>;
    readonly driver: ControlDriverDescriptor<'sql', TTargetId>;
    readonly extensions: readonly ControlExtensionDescriptor<'sql', TTargetId>[];
  }): SqlControlFamilyInstance;

  create<TTargetId extends string>(options: {
    readonly target: TargetDescriptor<'sql'> | ControlTargetDescriptor<'sql', TTargetId>;
    readonly adapter: AdapterDescriptor<'sql'> | ControlAdapterDescriptor<'sql', TTargetId>;
    readonly driver?: ControlDriverDescriptor<'sql', TTargetId>;
    readonly extensions?:
      | ReadonlyArray<ExtensionDescriptor<'sql'>>
      | readonly ControlExtensionDescriptor<'sql', TTargetId>[];
  }): SqlFamilyInstance {
    // Handle legacy descriptors (without driver)
    if (
      'kind' in options.target &&
      options.target.kind === 'target' &&
      !('targetId' in options.target)
    ) {
      return createSqlFamilyInstance({
        target: options.target as TargetDescriptor<'sql'>,
        adapter: options.adapter as AdapterDescriptor<'sql'>,
        extensions: (options.extensions ?? []) as ReadonlyArray<ExtensionDescriptor<'sql'>>,
      });
    }

    // Handle new Control* descriptors
    return createSqlFamilyInstance({
      target: options.target as ControlTargetDescriptor<'sql', TTargetId>,
      adapter: options.adapter as ControlAdapterDescriptor<'sql', TTargetId>,
      extensions: (options.extensions ?? []) as readonly ControlExtensionDescriptor<
        'sql',
        TTargetId
      >[],
    });
  }
}
