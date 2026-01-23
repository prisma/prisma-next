import type {
  ControlFamilyDescriptor,
  ControlPlaneStack,
} from '@prisma-next/core-control-plane/types';
import { sqlTargetFamilyHook } from '@prisma-next/sql-contract-emitter';
import type { SqlControlDescriptorWithContributions } from './assembly';
import { createSqlFamilyInstance, type SqlControlFamilyInstance } from './control-instance';
import type {
  SqlControlAdapterDescriptor,
  SqlControlExtensionDescriptor,
} from './migrations/types';

/**
 * SQL family descriptor implementation.
 * Provides the SQL family hook and factory method.
 *
 * Note: The stack's descriptors must implement SqlControlStaticContributions
 * (i.e., have operationSignatures() methods). This is enforced by the SQL
 * descriptor types (SqlControlTargetDescriptor, SqlControlAdapterDescriptor, etc.).
 */
export class SqlFamilyDescriptor
  implements ControlFamilyDescriptor<'sql', SqlControlFamilyInstance>
{
  readonly kind = 'family' as const;
  readonly id = 'sql';
  readonly familyId = 'sql' as const;
  readonly version = '0.0.1';
  readonly hook = sqlTargetFamilyHook;

  create<TTargetId extends string>(
    stack: ControlPlaneStack<'sql', TTargetId>,
  ): SqlControlFamilyInstance {
    // Note: driver is not passed here because SqlFamilyInstance operations
    // (validate, emit, etc.) don't require DB connectivity. Commands that
    // need the driver (verify, introspect) get it directly from the stack.
    //
    // Assert that the stack's descriptors implement SqlControlStaticContributions.
    // This is a runtime contract: SQL descriptors must provide operationSignatures().
    const target = stack.target as unknown as SqlControlDescriptorWithContributions;
    const adapter = stack.adapter as unknown as SqlControlAdapterDescriptor<TTargetId>;
    const extensionPacks =
      stack.extensionPacks as unknown as readonly SqlControlExtensionDescriptor<TTargetId>[];
    return createSqlFamilyInstance({
      target,
      adapter,
      extensionPacks,
    });
  }
}
