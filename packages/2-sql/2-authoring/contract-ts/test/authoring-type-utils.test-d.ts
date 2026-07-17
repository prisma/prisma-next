import type { AuthoringArgumentDescriptor } from '@prisma-next/framework-components/authoring';
import { expectTypeOf, test } from 'vitest';
import type {
  ArgTypeFromDescriptor,
  TupleFromArgumentDescriptors,
} from '../src/authoring-type-utils';

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
