/**
 * Class-based `Codec` abstract base — Pattern E.
 *
 * Concrete codec authors extend this class to declare a typed runtime
 * codec instance. The base carries a variance-erased descriptor
 * reference (`CodecDescriptor<any>`); `id` and `traits` proxy through
 * the descriptor so one source of truth governs both metadata reads
 * and aliasing semantics (alias subclasses inherit the descriptor's
 * id automatically).
 *
 * Class generic shape: `Id`, `TTraits`, `TWire`, `TInput`. Method
 * generics on the codec subclass's own surface (e.g. arktype-json's
 * schema generic, pgvector's dimension generic) flow through the
 * subclass's constructor and propagate via the descriptor's typed
 * `factory(params)` return at *direct* call sites.
 *
 * Sibling of {@link import('../codec-types').Codec} (legacy interface
 * form) during TML-2357 M0 Phase B; Phase C deletes the interface
 * form once every codec migrates. See
 * `projects/codec-registration-completion/specs/class-based-codec-design.spec.md`
 * § "Class hierarchy" for the design rationale.
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
