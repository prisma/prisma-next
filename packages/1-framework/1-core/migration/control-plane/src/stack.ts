import type {
  ControlAdapterDescriptor,
  ControlDriverDescriptor,
  ControlExtensionDescriptor,
  ControlPlaneStack,
  ControlTargetDescriptor,
} from './types';

/**
 * Creates a ControlPlaneStack from component descriptors.
 *
 * Provides sensible defaults:
 * - `driver` defaults to `undefined` (optional for commands that don't need DB connection)
 * - `extensionPacks` defaults to `[]` (empty array)
 *
 * @example
 * ```ts
 * const stack = createControlPlaneStack({
 *   target: postgresTarget,
 *   adapter: postgresAdapter,
 *   driver: postgresDriver, // optional
 *   extensionPacks: [pgvector], // optional
 * });
 * ```
 */
export function createControlPlaneStack<TFamilyId extends string, TTargetId extends string>(input: {
  readonly target: ControlTargetDescriptor<TFamilyId, TTargetId>;
  readonly adapter: ControlAdapterDescriptor<TFamilyId, TTargetId>;
  readonly driver?: ControlDriverDescriptor<TFamilyId, TTargetId> | undefined;
  readonly extensionPacks?: readonly ControlExtensionDescriptor<TFamilyId, TTargetId>[] | undefined;
}): ControlPlaneStack<TFamilyId, TTargetId> {
  return {
    target: input.target,
    adapter: input.adapter,
    driver: input.driver,
    extensionPacks: input.extensionPacks ?? [],
  };
}
