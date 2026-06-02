import type { RuntimeFamilyDescriptor } from '@prisma-next/framework-components/execution';
import type { SqlStaticContributions } from '@prisma-next/sql-runtime';
import { sqlFamilyOperations } from './query-operations';
import { createSqlRuntimeFamilyInstance, type SqlRuntimeFamilyInstance } from './runtime-instance';

/**
 * SQL execution-plane family descriptor.
 *
 * Note: this is currently named `sqlRuntimeFamilyDescriptor` because the execution plane
 * framework types are still using the `Runtime*` naming (`RuntimeFamilyDescriptor`, etc.).
 *
 * This will be renamed to `sqlExecutionFamilyDescriptor` as part of `TML-1842`.
 *
 * The descriptor also satisfies the structural `SqlStaticContributions`
 * shape: `codecs()` returns an empty list (the family owns no codecs —
 * targets and adapters do), and `queryOperations()` returns the family's
 * 15 query-operation descriptors. Slice 3 wires the family into
 * `createExecutionContext`'s contributors loop so the registry picks up
 * these entries alongside the target's and adapter's.
 */
export const sqlRuntimeFamilyDescriptor: RuntimeFamilyDescriptor<'sql', SqlRuntimeFamilyInstance> &
  SqlStaticContributions = {
  kind: 'family',
  id: 'sql',
  familyId: 'sql',
  version: '0.0.1',
  codecs: () => [],
  queryOperations: () => sqlFamilyOperations(),
  create() {
    return createSqlRuntimeFamilyInstance();
  },
};

Object.freeze(sqlRuntimeFamilyDescriptor);
