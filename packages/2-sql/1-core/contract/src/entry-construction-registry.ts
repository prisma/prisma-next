import { blindCast } from '@prisma-next/utils/casts';
import { StorageTable, type StorageTableInput } from './ir/storage-table';
import { StorageValueSet, type StorageValueSetInput } from './ir/storage-value-set';

export type EntryFactory = (value: unknown) => unknown;

const tableFactory: EntryFactory = (v) =>
  new StorageTable(
    blindCast<StorageTableInput, 'entry-construction-registry: table entry is StorageTableInput'>(
      v,
    ),
  );

const valueSetFactory: EntryFactory = (v) =>
  new StorageValueSet(
    blindCast<
      StorageValueSetInput,
      'entry-construction-registry: valueSet entry is StorageValueSetInput'
    >(v),
  );

/**
 * Builds the per-namespace entry construction registry. SQL core registers
 * `table` and `valueSet`; target packs contribute additional kinds via
 * `packFactories`. Mirrors the shape of `createSqlEntrySchemaRegistry`.
 *
 * Throws when a pack factory collides with a core kind.
 */
export function createSqlEntryConstructionRegistry(
  packFactories?: ReadonlyMap<string, EntryFactory>,
): ReadonlyMap<string, EntryFactory> {
  const registry = new Map<string, EntryFactory>([
    ['table', tableFactory],
    ['valueSet', valueSetFactory],
  ]);
  if (packFactories !== undefined) {
    for (const [kind, factory] of packFactories) {
      if (registry.has(kind)) {
        throw new Error(
          `createSqlEntryConstructionRegistry: pack factory "${kind}" collides with a core kind — pack factories cannot override "table" or "valueSet"`,
        );
      }
      registry.set(kind, factory);
    }
  }
  return registry;
}

/**
 * Dispatch loop shared by construction and hydration sites. For each kind in
 * `entries`: if the registry has a factory, apply it to each inner-map value
 * to produce IR instances; otherwise freeze-and-carry the map unchanged.
 */
export function dispatchEntriesToRegistry(
  entries: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
  registry: ReadonlyMap<string, EntryFactory>,
): Record<string, Readonly<Record<string, unknown>>> {
  const result: Record<string, Readonly<Record<string, unknown>>> = {};
  for (const [kind, rawMap] of Object.entries(entries)) {
    const factory = registry.get(kind);
    if (factory !== undefined) {
      const built: Record<string, unknown> = {};
      for (const [name, value] of Object.entries(rawMap)) {
        built[name] = factory(value);
      }
      result[kind] = Object.freeze(built);
    } else {
      result[kind] = Object.freeze(rawMap);
    }
  }
  return result;
}
