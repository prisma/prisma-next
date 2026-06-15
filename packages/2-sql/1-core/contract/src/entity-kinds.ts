import type {
  AnyEntityKindDescriptor,
  EntityKindDescriptor,
} from '@prisma-next/framework-components/ir';
import { StorageTableSchema, StorageValueSetSchema } from './ir/storage-entry-schemas';
import { StorageTable, type StorageTableInput } from './ir/storage-table';
import { StorageValueSet, type StorageValueSetInput } from './ir/storage-value-set';

export const tableEntityKind: EntityKindDescriptor<StorageTableInput, StorageTable> = {
  kind: 'table',
  schema: StorageTableSchema,
  construct: (input) => new StorageTable(input),
};

export const valueSetEntityKind: EntityKindDescriptor<StorageValueSetInput, StorageValueSet> = {
  kind: 'valueSet',
  schema: StorageValueSetSchema,
  construct: (input) => new StorageValueSet(input),
};

/**
 * Assembles the `kind → descriptor` registry for SQL namespaces: the built-in
 * `table` and `valueSet` kinds plus any target `packKinds`. This builds the
 * lookup table — it does not touch contract data. `hydrateNamespaceEntities`
 * later consumes this registry to turn a namespace's raw entries into IR
 * instances, and `createSqlContractSchema` derives validation from the same
 * registry. Throws on a duplicate kind.
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
        `composeSqlEntityKinds: duplicate entity kind "${descriptor.kind}" — each kind may be registered only once`,
      );
    }
    kinds.set(descriptor.kind, descriptor);
  }
  return kinds;
}
