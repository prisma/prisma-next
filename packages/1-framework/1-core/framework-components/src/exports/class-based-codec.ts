/**
 * Class-based codec exports — Pattern E spike.
 *
 * Parallel surface to {@link import('./codec')}. The interface form
 * (`Codec`/`CodecDescriptor` types) stays as the production shape; this
 * module exposes the class-based hierarchy plus the `column()`
 * packager and `ColumnHelperFor<D>` shapes used by per-codec helpers.
 *
 * Spike scope is `pgInt4` (non-parameterized) and `pgVector`
 * (parameterized) only — see `class-based-codec-design.spec.md`.
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
