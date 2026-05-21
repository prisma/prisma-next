/**
 * Compile-time type tests for `.default(value)` on the TS DSL:
 *
 * - `.default(autoincrement())` is admitted only on column builders whose
 *   descriptor declares the `'autoincrement'` trait. Calling it on a
 *   descriptor without the trait is a compile error.
 * - `.default(matchingTInput)` compiles for representative codec inputs.
 * - `.default(invalidValue)` is a compile error across the same inputs.
 *
 * The tests use the trait-aware test helper rather than codec packs so the
 * trait surfacing is independent of the production column helpers being
 * updated. Production column helpers will eventually surface traits the
 * same way (a separate dispatch); the type-level extractor is exercised
 * here against the test-helper shape directly.
 */

import { describe, test } from 'vitest';
import { autoincrement, field } from '../src/contract-builder';
import { columnDescriptor, columnDescriptorWithTraits } from './helpers/column-descriptor';
import { syntheticCodecDescriptor } from './helpers/synthetic-codec-descriptor';

const int4Column = columnDescriptorWithTraits('pg/int4@1', [
  'equality',
  'order',
  'numeric',
  'autoincrement',
] as const);
const textColumn = columnDescriptorWithTraits('pg/text@1', [
  'equality',
  'order',
  'textual',
] as const);
const boolColumn = columnDescriptorWithTraits('pg/bool@1', ['equality', 'boolean'] as const);
const noTraitsColumn = columnDescriptor('pg/json@1');

describe('.default(autoincrement()) trait gating', () => {
  test('compiles when codec descriptor declares the autoincrement trait', () => {
    field.column(int4Column).default(autoincrement());
  });

  test('compile error when codec descriptor lacks the autoincrement trait', () => {
    // @ts-expect-error pg/text@1 does not carry the autoincrement trait
    field.column(textColumn).default(autoincrement());
    // @ts-expect-error pg/bool@1 does not carry the autoincrement trait
    field.column(boolColumn).default(autoincrement());
  });

  test('compile error when descriptor surfaces no traits at the type level', () => {
    // @ts-expect-error descriptor without `traits` field surfaces never as the sentinel arm
    field.column(noTraitsColumn).default(autoincrement());
  });
});

describe('.default(value) literal-input shape', () => {
  test('accepts representative JSON-shaped literals', () => {
    field.column(textColumn).default('hello');
    field.column(int4Column).default(42);
    field.column(boolColumn).default(true);
    field.column(textColumn).default(null);
    field.column(noTraitsColumn).default({ foo: 'bar', nested: [1, 2, 3] });
  });

  test('accepts Date as a non-JSON literal', () => {
    const timestamptzColumn = columnDescriptor('pg/timestamptz@1');
    field.column(timestamptzColumn).default(new Date('2026-05-20'));
  });

  test('accepts bigint as a non-JSON literal', () => {
    const int8Column = columnDescriptor('pg/int8@1');
    field.column(int8Column).default(9007199254740993n);
  });

  test('accepts Uint8Array as a non-JSON literal', () => {
    const byteaColumn = columnDescriptor('pg/bytea@1');
    field.column(byteaColumn).default(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
  });

  test('compile error for functions, undefined, and unsupported objects', () => {
    // @ts-expect-error function literal is not a permitted default value
    field.column(textColumn).default(() => 'computed');
    // @ts-expect-error undefined is not a permitted default value
    field.column(textColumn).default(undefined);
    // @ts-expect-error symbol is not a permitted default value
    field.column(textColumn).default(Symbol('s'));
  });
});

describe('autoincrement() sentinel identity', () => {
  test('sentinel is recoverable via the autoincrement() factory', () => {
    const a = autoincrement();
    const b = autoincrement();
    // referential identity check — every call returns the singleton sentinel,
    // and the type system rejects sentinel reconstruction outside the factory.
    if (a !== b) {
      throw new Error('autoincrement() must return the same singleton sentinel on every call');
    }
  });
});

// These tests are the load-bearing proof that the `.default(value)` extractor
// is open-set: an arbitrary codec's `TInput` flows into the DSL without the
// DSL enumerating the shape. A closed enumeration would compile the legacy
// JSON / Date / bigint / Uint8Array cases above while rejecting the branded
// values and class instances below — which is exactly the failure-mode the
// extractor replaces.

declare const emailAddressBrand: unique symbol;
type EmailAddress = string & { readonly [emailAddressBrand]: 'EmailAddress' };

declare const userIdBrand: unique symbol;
type UserId = number & { readonly [userIdBrand]: 'UserId' };

class Money {
  // Private field makes Money nominal: structurally-equivalent plain objects
  // do not satisfy the class type. This is the load-bearing distinction
  // between "codec admits a class instance" and "codec admits a plain bag".
  readonly #nominal = true;
  constructor(
    readonly amount: number,
    readonly currency: string,
  ) {
    void this.#nominal;
  }
}

class Temperature {
  readonly #nominal = true;
  constructor(readonly celsius: number) {
    void this.#nominal;
  }
}

describe('.default(value) extracts codec TInput from descriptor (branded scalars)', () => {
  test('accepts a branded string when the codec admits it', () => {
    const emailColumn = syntheticCodecDescriptor<
      'app/email@1',
      readonly ['equality'],
      EmailAddress
    >('app/email@1', ['equality'] as const, 'text');
    const branded = 'user@example.com' as EmailAddress;
    field.column(emailColumn).default(branded);
  });

  test('rejects an unbranded string for a brand-typed codec', () => {
    const emailColumn = syntheticCodecDescriptor<
      'app/email@1',
      readonly ['equality'],
      EmailAddress
    >('app/email@1', ['equality'] as const, 'text');
    // @ts-expect-error a plain string is not assignable to EmailAddress without the brand
    field.column(emailColumn).default('user@example.com');
  });

  test('accepts a branded number when the codec admits it', () => {
    const userIdColumn = syntheticCodecDescriptor<
      'app/userId@1',
      readonly ['equality', 'order'],
      UserId
    >('app/userId@1', ['equality', 'order'] as const, 'int4');
    const branded = 42 as UserId;
    field.column(userIdColumn).default(branded);
  });

  test('rejects an unbranded number for a brand-typed codec', () => {
    const userIdColumn = syntheticCodecDescriptor<
      'app/userId@1',
      readonly ['equality', 'order'],
      UserId
    >('app/userId@1', ['equality', 'order'] as const, 'int4');
    // @ts-expect-error a plain number is not assignable to UserId without the brand
    field.column(userIdColumn).default(7);
  });
});

describe('.default(value) extracts codec TInput from descriptor (class instances)', () => {
  test('accepts a Money instance when the codec admits Money', () => {
    const moneyColumn = syntheticCodecDescriptor<'app/money@1', readonly ['equality'], Money>(
      'app/money@1',
      ['equality'] as const,
      'numeric',
    );
    field.column(moneyColumn).default(new Money(99, 'USD'));
  });

  test('rejects an unrelated class instance for a Money-typed codec', () => {
    const moneyColumn = syntheticCodecDescriptor<'app/money@1', readonly ['equality'], Money>(
      'app/money@1',
      ['equality'] as const,
      'numeric',
    );
    // @ts-expect-error Temperature is structurally incompatible with Money (different property set)
    field.column(moneyColumn).default(new Temperature(20));
  });

  test('rejects a plain object literal for a class-typed codec', () => {
    const moneyColumn = syntheticCodecDescriptor<'app/money@1', readonly ['equality'], Money>(
      'app/money@1',
      ['equality'] as const,
      'numeric',
    );
    // @ts-expect-error plain object is missing the nominal class identity Money carries
    field.column(moneyColumn).default({ amount: 99, currency: 'USD' });
  });
});
