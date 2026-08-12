import postgresAdapterControlDescriptor from '@prisma-next/adapter-postgres/control';
import postgresRuntimeAdapterDescriptor from '@prisma-next/adapter-postgres/runtime';
import sqlFamilyDescriptor from '@prisma-next/family-sql/control';
import type { SqlControlAdapter } from '@prisma-next/family-sql/control-adapter';
import type { ControlExtensionDescriptor } from '@prisma-next/framework-components/control';
import { createControlStack } from '@prisma-next/framework-components/control';
import type {
  RuntimeExtensionDescriptor,
  RuntimeTargetDescriptor,
} from '@prisma-next/framework-components/execution';
import postgresTargetControlDescriptor from '@prisma-next/target-postgres/control';

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
  readonly extensions: readonly RuntimeExtensionDescriptor<'sql', 'postgres'>[];
}) {
  return postgresRuntimeAdapterDescriptor.create({
    target: stubRuntimeTarget,
    adapter: postgresRuntimeAdapterDescriptor,
    driver: undefined,
    extensions: options.extensions,
  });
}

/**
 * Build a stack-composed Postgres control adapter for tests that exercise
 * extension codecs. Goes through the public `create(stack)` factory on the
 * adapter's control descriptor (same path `exports/control.ts` uses in
 * production) to keep the test helper aligned with the codebase's
 * "factories not classes" coding convention. Composes against the real SQL
 * family / postgres target / postgres adapter control descriptors so the
 * codec lookup is assembled from the same metadata sources production uses.
 */
export function createComposedPostgresControlAdapter(options: {
  readonly extensions: readonly ControlExtensionDescriptor<'sql', 'postgres'>[];
}): SqlControlAdapter<'postgres'> {
  const stack = createControlStack({
    family: sqlFamilyDescriptor,
    target: postgresTargetControlDescriptor,
    adapter: postgresAdapterControlDescriptor,
    extensions: options.extensions,
  });
  return postgresAdapterControlDescriptor.create(stack) as SqlControlAdapter<'postgres'>;
}
