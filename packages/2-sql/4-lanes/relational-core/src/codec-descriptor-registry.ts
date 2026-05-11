import type { JsonValue } from '@prisma-next/contract/types';
import type { CodecDescriptor, CodecRef } from '@prisma-next/framework-components/codec';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { AnyCodecDescriptor } from './ast/codec-types';
import type { CodecDescriptorRegistry } from './query-lane-context';

/**
 * Build a {@link CodecDescriptorRegistry} from a flat descriptor list.
 *
 * Used by:
 * - Each codec-shipping package's `core/registry.ts` to expose a package-scoped registry as the public consumer surface (replacing raw descriptor-array exports). See ADR 208.
 * - The runtime's `buildExecutionContext` to construct the contract-bound combined registry from every contributor's `codecs:` slot.
 *
 * The descriptor map is heterogeneous in `P` — each codec id has its own params shape. The public {@link CodecDescriptorRegistry} interface widens to `CodecDescriptor<unknown>` and consumers narrow per codec id at the call site (the descriptor's `paramsSchema` validates JSON-sourced params before the factory ever sees them, so the runtime narrow is safe). The cast at registration goes through `unknown` because
 * `CodecDescriptor<P>` is invariant in `P` (the `factory` and `renderOutputType` slots use `P` contravariantly).
 */
export function buildCodecDescriptorRegistry(
  allDescriptors: ReadonlyArray<AnyCodecDescriptor>,
  storage?: SqlStorage,
): CodecDescriptorRegistry {
  type AnyDescriptor = CodecDescriptor<unknown>;
  const byId = new Map<string, AnyDescriptor>();
  const byTargetType = new Map<string, Array<AnyDescriptor>>();

  for (const descriptor of allDescriptors) {
    if (byId.has(descriptor.codecId)) {
      throw new Error(
        `Duplicate codec descriptor id: '${descriptor.codecId}' — registered twice during registry construction. ` +
          'Each codecId must be contributed by exactly one component (target / adapter / extension pack).',
      );
    }
    const widened = descriptor as unknown as AnyDescriptor;
    byId.set(descriptor.codecId, widened);
    for (const targetType of descriptor.targetTypes) {
      const list = byTargetType.get(targetType);
      if (list) {
        list.push(widened);
      } else {
        byTargetType.set(targetType, [widened]);
      }
    }
  }

  return {
    descriptorFor(codecId: string): AnyDescriptor | undefined {
      return byId.get(codecId);
    },
    codecRefForColumn(table: string, column: string): CodecRef | undefined {
      if (!storage) return undefined;
      const tableDef = storage.tables[table];
      if (!tableDef) return undefined;
      const columnDef = tableDef.columns[column];
      if (!columnDef) return undefined;
      if (columnDef.typeRef !== undefined) {
        const instance = storage.types?.[columnDef.typeRef];
        if (!instance) return undefined;
        // Contract storage carries `typeParams: Record<string, unknown>` but every value must be JSON-shaped to survive serialization to `contract.json`; descriptors validate the value via `paramsSchema` at JSON load time. The narrow is safe by that invariant.
        return { codecId: instance.codecId, typeParams: instance.typeParams as JsonValue };
      }
      if (columnDef.typeParams !== undefined) {
        return { codecId: columnDef.codecId, typeParams: columnDef.typeParams as JsonValue };
      }
      return { codecId: columnDef.codecId };
    },
    *values(): IterableIterator<AnyDescriptor> {
      yield* byId.values();
    },
    byTargetType(targetType: string): readonly AnyDescriptor[] {
      return byTargetType.get(targetType) ?? Object.freeze([]);
    },
  };
}
