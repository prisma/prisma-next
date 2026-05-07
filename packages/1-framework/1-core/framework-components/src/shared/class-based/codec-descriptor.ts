/**
 * Class-based `CodecDescriptor` abstract base — Pattern E.
 *
 * Concrete codec authors `extend` this class to declare their codec
 * id, traits, target types, params schema, the `factory(params)` that
 * materializes a typed `Codec<...>`, and (optionally) a
 * `renderOutputType(params)` for the emit path.
 *
 * The factory's method-level generic is the load-bearing piece for
 * literal preservation: per-codec column helpers invoke
 * `descriptor.factory(...)` *directly*, and the direct call binds the
 * generic at its call site. Type extraction (`ReturnType<D['factory']>`,
 * structural matching) widens method generics to their constraint —
 * that's why the column-helper surface is per-codec, not polymorphic.
 *
 * Sibling of {@link import('../codec-types').CodecDescriptor} (legacy
 * interface form) during TML-2357 M0 Phase B; Phase C deletes the
 * interface form. See
 * `projects/codec-registration-completion/specs/class-based-codec-design.spec.md`
 * for the full design.
 */

import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { CodecInstanceContext, CodecMeta, CodecTrait } from '../codec-types';
import type { Codec } from './codec';

export abstract class CodecDescriptor<TParams = void> {
  abstract readonly codecId: string;
  abstract readonly traits: readonly CodecTrait[];
  abstract readonly targetTypes: readonly string[];
  readonly meta?: CodecMeta;

  abstract readonly paramsSchema: StandardSchemaV1<TParams>;

  /**
   * Optional emit-path string renderer for `contract.d.ts`. Returns the
   * TypeScript output type expression for the given params (e.g.
   * `Vector<1536>`). Non-parameterized codecs typically omit it.
   */
  renderOutputType?(params: TParams): string | undefined;

  /**
   * Materialize a curried codec factory for the given params. Concrete
   * subclasses override with a typed return type (e.g.
   * `factory<N>(params: { length: N }): (ctx) => VectorCodec<N>`); per-
   * codec helpers read the typed return at the *direct* call site,
   * which is what preserves method-level generics. Type extraction
   * (e.g. `ReturnType<D['factory']>`) widens method generics to their
   * constraint — that's why the column-helper surface is per-codec, not
   * polymorphic.
   */
  abstract factory(
    params: TParams,
  ): (ctx: CodecInstanceContext) => Codec<string, readonly CodecTrait[], unknown, unknown>;
}

/**
 * Variance-erased {@link CodecDescriptor} alias for heterogeneous
 * collections (e.g. registry storage). Mirrors the existing interface-
 * form `AnyCodecDescriptor`; `CodecDescriptor<P>` is invariant in `P`,
 * so a concrete `CodecDescriptor<{length: number}>` does not extend
 * `CodecDescriptor<unknown>` for unrelated `P`.
 */
// biome-ignore lint/suspicious/noExplicitAny: variance erasure for heterogeneous descriptor collections
export type AnyCodecDescriptor = CodecDescriptor<any>;
