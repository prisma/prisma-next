/**
 * Class-based codec exports — Pattern E.
 *
 * Canonical class hierarchy and column-packaging machinery for the
 * codec model. Codec authors `extend` the {@link Codec} and
 * {@link CodecDescriptor} abstract bases, write a per-codec column
 * helper that calls `descriptor.factory(...)` directly, and tie the
 * helper to its descriptor with `satisfies ColumnHelperFor<D>` (or
 * `ColumnHelperForStrict<D>`).
 *
 * Co-exists with the legacy interface form
 * ({@link import('../shared/codec-types').Codec},
 * {@link import('../shared/codec-types').CodecDescriptor}) during
 * TML-2357 M0 Phase B. Phase C deletes the interface form once every
 * codec migrates; this becomes the canonical surface.
 *
 * See `projects/codec-registration-completion/specs/class-based-codec-design.spec.md`
 * for the full design, the per-codec authoring patterns, and the
 * variance discipline the helpers rely on.
 */

export { Codec } from '../shared/class-based/codec';
export type { AnyCodecDescriptor } from '../shared/class-based/codec-descriptor';
export { CodecDescriptor } from '../shared/class-based/codec-descriptor';
export type {
  ColumnHelperFor,
  ColumnHelperForStrict,
  ColumnSpec,
} from '../shared/class-based/column-spec';
export { column } from '../shared/class-based/column-spec';
