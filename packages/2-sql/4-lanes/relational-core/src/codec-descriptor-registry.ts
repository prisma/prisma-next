import type { CodecDescriptor } from '@prisma-next/framework-components/codec';
import type { AnyCodecDescriptor } from './ast/codec-types';
import type { CodecDescriptorRegistry } from './query-lane-context';

/**
 * Build a {@link CodecDescriptorRegistry} from a flat descriptor list.
 *
 * Used by:
 * - Each codec-shipping package's `core/registry.ts` to expose a
 *   package-scoped registry as the public consumer surface (replacing
 *   raw descriptor-array exports). See ADR 208.
 * - The runtime's `buildExecutionContext` to construct the contract-
 *   bound combined registry from every contributor's `codecs:` slot.
 *
 * The descriptor map is heterogeneous in `P` — each codec id has its
 * own params shape. The public {@link CodecDescriptorRegistry} interface
 * widens to `CodecDescriptor<unknown>` and consumers narrow per codec
 * id at the call site (the descriptor's `paramsSchema` validates
 * JSON-sourced params before the factory ever sees them, so the
 * runtime narrow is safe). The cast at registration goes through
 * `unknown` because `CodecDescriptor<P>` is invariant in `P` (the
 * `factory` and `renderOutputType` slots use `P` contravariantly).
 */
export function buildCodecDescriptorRegistry(
  allDescriptors: ReadonlyArray<AnyCodecDescriptor>,
): CodecDescriptorRegistry {
  type AnyDescriptor = CodecDescriptor<unknown>;
  const byId = new Map<string, AnyDescriptor>();
  const byTargetType = new Map<string, Array<AnyDescriptor>>();

  for (const descriptor of allDescriptors) {
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
    *values(): IterableIterator<AnyDescriptor> {
      yield* byId.values();
    },
    byTargetType(targetType: string): readonly AnyDescriptor[] {
      return byTargetType.get(targetType) ?? Object.freeze([]);
    },
  };
}
