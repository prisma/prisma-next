import type { AuthoringArgumentDescriptor } from '@prisma-next/framework-components/authoring';
import { expectTypeOf, test } from 'vitest';
import type {
  ArgTypeFromDescriptor,
  FieldHelperFunctionWithNamedConstraint,
  NamedConstraintSpec,
  TupleFromArgumentDescriptors,
} from '../src/authoring-type-utils';

const nanoidDescriptor = {
  kind: 'fieldPreset',
  args: [
    {
      kind: 'object',
      optional: true,
      properties: {
        size: { kind: 'number', optional: true, integer: true, minimum: 2, maximum: 255 },
      },
    },
  ],
  output: {
    codecId: 'sql/char@1',
    nativeType: 'character',
    typeParams: { length: { kind: 'arg', index: 0, path: ['size'], default: 21 } },
    id: true,
  },
} as const;

const uuidv4Descriptor = {
  kind: 'fieldPreset',
  output: {
    codecId: 'sql/char@1',
    nativeType: 'character',
    typeParams: { length: 36 },
    id: true,
  },
} as const;

declare const idNanoid: FieldHelperFunctionWithNamedConstraint<typeof nanoidDescriptor>;
declare const idUuidv4String: FieldHelperFunctionWithNamedConstraint<typeof uuidv4Descriptor>;

test('option-kind descriptor types as the literal union of its values', () => {
  type OnCreateArg = { readonly kind: 'option'; readonly values: readonly ['now'] };
  expectTypeOf<ArgTypeFromDescriptor<OnCreateArg>>().toEqualTypeOf<'now'>();

  type MultiValueArg = { readonly kind: 'option'; readonly values: readonly ['now', 'never'] };
  expectTypeOf<ArgTypeFromDescriptor<MultiValueArg>>().toEqualTypeOf<'now' | 'never'>();
});

test('optional descriptors get optional tuple slots', () => {
  const args = [
    { kind: 'number', optional: true, integer: true, minimum: 0 },
    { kind: 'option', values: ['now'], optional: true },
    { kind: 'option', values: ['now'], optional: true },
  ] as const satisfies readonly AuthoringArgumentDescriptor[];

  type Params = TupleFromArgumentDescriptors<typeof args>;

  expectTypeOf<Params>().toEqualTypeOf<readonly [number?, 'now'?, 'now'?]>();

  // Assignability is proved through a generic call site (matching real helper
  // usage) rather than a directly-typed variable: `exactOptionalPropertyTypes`
  // rejects an explicit `undefined` assigned to an optional tuple slot, but a
  // generic rest-parameter call inferring `Params` from the arguments is
  // unaffected — precisely the `field.temporal.timestamptz(undefined, undefined, 'now')`
  // call shape the design spec relies on.
  function acceptsParams<const P extends Params>(...args: P): P {
    return args;
  }

  acceptsParams();
  acceptsParams(3);
  acceptsParams(3, 'now', 'now');
  acceptsParams(undefined, undefined, 'now');
});

test('required descriptors keep required tuple slots', () => {
  const args = [
    { kind: 'string' },
    { kind: 'number', optional: true },
  ] as const satisfies readonly AuthoringArgumentDescriptor[];

  type Params = TupleFromArgumentDescriptors<typeof args>;

  expectTypeOf<Params>().toEqualTypeOf<readonly [string, number?]>();

  function acceptsParams<const P extends Params>(...args: P): P {
    return args;
  }

  acceptsParams('name');
  acceptsParams('name', 3);
  // @ts-expect-error required arg must precede the optional one; the call must supply it.
  acceptsParams();
});

/**
 * Covers design-spec §4.3: a preset that has optional args AND declares `id`
 * takes the named-constraint overload pair. Signature 1 (no options) must win
 * for calls whose arguments satisfy the preset args, so a single preset
 * argument is never mistaken for the constraint options.
 */
test('named-constraint helper resolves preset args and constraint options across both overloads', () => {
  expectTypeOf(idNanoid({ size: 16 }).build().id).toEqualTypeOf<NamedConstraintSpec<undefined>>();
  expectTypeOf(idNanoid().build().id).toEqualTypeOf<NamedConstraintSpec<undefined>>();
  expectTypeOf(idNanoid({ size: 16 }, { name: 'x' }).build().id).toEqualTypeOf<
    NamedConstraintSpec<'x'>
  >();
});

/**
 * Design-spec §4.3 row 3 (`field.id.nanoid({ name: 'x' })`) is NOT met, and
 * this test pins the actual behavior so the gap is visible rather than
 * silent. The spec expects signature 2 and constraint name 'x'; the call in
 * fact resolves via signature 1 with `Params = [{ name: 'x' }]` and yields no
 * constraint name.
 *
 * Cause: the spec's reasoning ("`{name}` is not assignable to the size-arg
 * object, so signature 1 rejects it") does not hold. `ObjectArgumentType`
 * builds `{} & { size?: number }` — an intersection whose empty-object
 * constituent defeats weak-type/excess-property rejection — so `{ name: 'x' }`
 * IS assignable to the size-arg object and signature 1 accepts it.
 *
 * This spelling was a compile error before the optional-tuple-slot change, so
 * it is not a regression against previously-working code, but it is a loss of
 * safety: what used to be rejected loudly now compiles to the wrong result.
 * Resolving it needs a decision from the spec owner (see dispatch 1 report).
 */
test('named-constraint helper: options-only call is not distinguished from a preset arg', () => {
  expectTypeOf(idNanoid({ name: 'x' }).build().id).toEqualTypeOf<NamedConstraintSpec<undefined>>();
});

test('named-constraint helper without declared args keeps the no-args branch', () => {
  expectTypeOf(idUuidv4String({ name: 'x' }).build().id).toEqualTypeOf<NamedConstraintSpec<'x'>>();
  expectTypeOf(idUuidv4String().build().id).toEqualTypeOf<NamedConstraintSpec<undefined>>();
});
