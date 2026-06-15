import type {
  AnyEntityKindDescriptor,
  EntityKindDescriptor,
} from '@prisma-next/framework-components/ir';
import { castAs } from '@prisma-next/utils/casts';
import type { Type } from 'arktype';
import { StorageTable, type StorageTableInput } from './ir/storage-table';
import { StorageValueSet, type StorageValueSetInput } from './ir/storage-value-set';
import { StorageTableSchema, StorageValueSetSchema } from './validators';

export const tableEntityKind: EntityKindDescriptor<StorageTableInput, StorageTable> = {
  kind: 'table',
  schema: castAs<Type<StorageTableInput>>(StorageTableSchema),
  construct: (input) => new StorageTable(input),
};

export const valueSetEntityKind: EntityKindDescriptor<StorageValueSetInput, StorageValueSet> = {
  kind: 'valueSet',
  schema: castAs<Type<StorageValueSetInput>>(StorageValueSetSchema),
  construct: (input) => new StorageValueSet(input),
};

/**
 * Builds the descriptor map for SQL namespaces. Core kinds are `table` and
 * `valueSet`; target packs contribute additional kinds via `packKinds`.
 *
 * Throws when a pack kind collides with a core kind.
 */
export function composeSqlEntityKinds(
  packKinds: readonly AnyEntityKindDescriptor[] = [],
): ReadonlyMap<string, AnyEntityKindDescriptor> {
  const kinds = new Map<string, AnyEntityKindDescriptor>([
    ['table', tableEntityKind],
    ['valueSet', valueSetEntityKind],
  ]);
  for (const descriptor of packKinds) {
    if (kinds.has(descriptor.kind)) {
      throw new Error(
        `composeSqlEntityKinds: pack kind "${descriptor.kind}" collides with a core kind — pack kinds cannot override "table" or "valueSet"`,
      );
    }
    kinds.set(descriptor.kind, descriptor);
  }
  return kinds;
}
