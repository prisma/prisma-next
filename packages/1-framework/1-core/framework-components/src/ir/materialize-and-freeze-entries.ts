import { type IRNode, IRNodeBase } from './ir-node';

/**
 * Walk every slot in an entries input object, materialise each entry via the
 * registry-supplied factory when the value is not already an `IRNode` class
 * instance, and return a deeply-frozen entries object.
 *
 * Both the outer entries record and each per-slot inner record are frozen.
 *
 * The helper iterates over input slots (not registry keys), so unknown slots
 * — slots present in `input` but absent from `registry` — pass through
 * as-is (cast to `IRNode`). Factory entries registered for slots absent in
 * `input` are skipped. Already-materialised `IRNodeBase` instances pass
 * through without re-construction (idempotent).
 *
 * Callers that need to emit a slot even when `input` lacks it should add
 * that slot explicitly before calling (e.g. `{ table: input.entries.table }`
 * rather than relying on the helper to invent it).
 */
export function materializeAndFreezeEntries(
  input: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
  registry: ReadonlyMap<string, (raw: unknown) => IRNode>,
): Readonly<Record<string, Readonly<Record<string, IRNode>>>> {
  const result: Record<string, Readonly<Record<string, IRNode>>> = {};
  for (const [slotName, slotValue] of Object.entries(input)) {
    const factory = registry.get(slotName);
    result[slotName] = Object.freeze(
      Object.fromEntries(
        Object.entries(slotValue).map(([entryName, entry]) => [
          entryName,
          entry instanceof IRNodeBase
            ? entry
            : factory !== undefined
              ? factory(entry)
              : (entry as IRNode),
        ]),
      ),
    );
  }
  return Object.freeze(result);
}
