import { blindCast } from '@prisma-next/utils/casts';
import type { Type } from 'arktype';

export interface EntityKindDescriptor<Input, Node> {
  readonly kind: string;
  readonly schema: Type<unknown>;
  readonly construct: (input: Input) => Node;
}

export type AnyEntityKindDescriptor = EntityKindDescriptor<never, unknown>;

/**
 * Shared construction loop for both SQL and Mongo entry maps.
 *
 * For each kind in `entries`: if the descriptor map has a descriptor,
 * construct each inner-map value; otherwise freeze-and-carry (`'carry'`)
 * or throw naming the kind and nsId (`'fail'`).
 *
 * The single boundary cast on line below hands `value` to
 * `descriptor.construct` as its `Input`. The value is the kind's `Input`
 * by the entries-input contract at authoring time or by prior
 * `validateStorage` validation at hydration time — these are the only two
 * call sites, and both hold the invariant. This replaces ~8 per-factory
 * casts from the old registry approach.
 */
export function constructEntries(
  entries: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
  kinds: ReadonlyMap<string, AnyEntityKindDescriptor>,
  onUnknown: 'carry' | 'fail',
  nsId?: string,
): Record<string, Readonly<Record<string, unknown>>> {
  const result: Record<string, Readonly<Record<string, unknown>>> = {};
  for (const [kind, rawMap] of Object.entries(entries)) {
    const descriptor = kinds.get(kind);
    if (descriptor !== undefined) {
      const built: Record<string, unknown> = {};
      for (const [name, value] of Object.entries(rawMap)) {
        built[name] = descriptor.construct(
          blindCast<never, 'entries-input contract on authoring / validateStorage on hydration'>(
            value,
          ),
        );
      }
      result[kind] = Object.freeze(built);
    } else if (onUnknown === 'carry') {
      result[kind] = Object.freeze(rawMap);
    } else {
      throw new Error(
        `Unknown entries key "${kind}" in namespace "${nsId ?? '?'}"; no hydration factory registered for this entity kind`,
      );
    }
  }
  return result;
}
