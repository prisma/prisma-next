import sqlFamilyDescriptor from '@prisma-next/family-sql/control';
import type { ControlExtensionDescriptor } from '@prisma-next/framework-components/control';
import { createControlStack } from '@prisma-next/framework-components/control';
import type {
  RuntimeExtensionDescriptor,
  RuntimeTargetDescriptor,
} from '@prisma-next/framework-components/execution';
import postgresControlAdapterDescriptor from '@prisma-next/target-postgres/control';
import { PostgresControlAdapter } from '../../src/core/control-adapter';
import postgresAdapterControlDescriptor from '../../src/exports/control';
import postgresRuntimeAdapterDescriptor from '../../src/exports/runtime';

const stubRuntimeTarget: RuntimeTargetDescriptor<'sql', 'postgres'> = {
  kind: 'target',
  id: 'postgres',
  version: '0.0.1',
  familyId: 'sql',
  targetId: 'postgres',
  create() {
    return { familyId: 'sql', targetId: 'postgres' };
  },
};

/**
 * Build a stack-composed Postgres runtime adapter for tests that exercise
 * extension codecs (e.g. `pg/vector@1`). The bare `createPostgresAdapter()`
 * factory cannot see extension codecs by design (ADR 205), so any test that
 * lowers a `ParamRef` carrying an extension-codec id must compose a stack
 * with the relevant extension pack(s).
 */
export function createComposedPostgresAdapter(options: {
  readonly extensionPacks: readonly RuntimeExtensionDescriptor<'sql', 'postgres'>[];
}) {
  return postgresRuntimeAdapterDescriptor.create({
    target: stubRuntimeTarget,
    adapter: postgresRuntimeAdapterDescriptor,
    driver: undefined,
    extensionPacks: options.extensionPacks,
  });
}

/**
 * Build a stack-composed Postgres control adapter for tests that exercise
 * extension codecs. Mirrors `exports/control.ts`: the control descriptor's
 * `create(stack)` reads `stack.codecLookup` and constructs the
 * `PostgresControlAdapter` with it. Compose against the real SQL family /
 * postgres target / postgres adapter control descriptors so the codec
 * lookup is assembled from the same metadata sources production uses.
 */
export function createComposedPostgresControlAdapter(options: {
  readonly extensionPacks: readonly ControlExtensionDescriptor<'sql', 'postgres'>[];
}) {
  const stack = createControlStack({
    family: sqlFamilyDescriptor,
    target: postgresControlAdapterDescriptor,
    adapter: postgresAdapterControlDescriptor,
    extensionPacks: options.extensionPacks,
  });
  return new PostgresControlAdapter(stack.codecLookup);
}
