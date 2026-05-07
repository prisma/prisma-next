/**
 * Class-based `Codec` abstract base — Pattern E spike.
 *
 * Sibling of {@link import('../codec-types').Codec} (the interface form).
 * Lives in parallel for the `class-based-codec-design.spec.md` spike: the
 * existing interface stays as the production shape; this class form is
 * exercised end-to-end for `pgInt4` and `pgVector` to validate per-codec
 * helpers + `satisfies` discipline preserve method-level generics.
 *
 * Class generic shape mirrors the interface: `Id`, `TTraits`, `TWire`,
 * `TInput`. The instance carries the descriptor reference so `id` and
 * `traits` proxy through one source of truth. See spec § "Class
 * hierarchy" for the design rationale (instance-side aliasing, codec
 * subclass uniformity across the codec spectrum).
 */

import type { JsonValue } from '@prisma-next/contract/types';
import type { CodecCallContext, CodecTrait } from '../codec-types';
import type { CodecDescriptor } from './codec-descriptor';

export abstract class Codec<
  Id extends string = string,
  TTraits extends readonly CodecTrait[] = readonly CodecTrait[],
  TWire = unknown,
  TInput = unknown,
> {
  /**
   * Variance-erased descriptor reference. Concrete codec subclasses
   * receive the typed descriptor in their own constructors and forward
   * it via `super(descriptor)`; the variance erasure lives at this base
   * because the abstract surface can't carry the concrete `TParams`.
   */
  // biome-ignore lint/suspicious/noExplicitAny: variance-erased descriptor reference; subclasses retain typed access via their own state
  constructor(public readonly descriptor: CodecDescriptor<any>) {}

  get id(): Id {
    return this.descriptor.codecId as Id;
  }

  get traits(): TTraits {
    return this.descriptor.traits as TTraits;
  }

  abstract encode(value: TInput, ctx: CodecCallContext): Promise<TWire>;
  abstract decode(wire: TWire, ctx: CodecCallContext): Promise<TInput>;

  encodeJson?(value: TInput): JsonValue;
  decodeJson?(json: JsonValue): TInput;
}
