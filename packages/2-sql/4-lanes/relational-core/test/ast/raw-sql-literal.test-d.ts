import { expectTypeOf, test } from 'vitest';
import type { RawSqlLiteral } from '../../src/exports/ast';

test('number satisfies RawSqlLiteral', () => {
  const v: RawSqlLiteral = 42;
  expectTypeOf(v).toExtend<RawSqlLiteral>();
});

test('string satisfies RawSqlLiteral', () => {
  const v: RawSqlLiteral = 'hello';
  expectTypeOf(v).toExtend<RawSqlLiteral>();
});

test('bigint satisfies RawSqlLiteral', () => {
  const v: RawSqlLiteral = 9007199254740993n;
  expectTypeOf(v).toExtend<RawSqlLiteral>();
});

test('boolean satisfies RawSqlLiteral', () => {
  const v: RawSqlLiteral = true;
  expectTypeOf(v).toExtend<RawSqlLiteral>();
});

test('Uint8Array satisfies RawSqlLiteral', () => {
  const v: RawSqlLiteral = new Uint8Array([1, 2, 3]);
  expectTypeOf(v).toExtend<RawSqlLiteral>();
});

test('Date is rejected — use param(date, { codecId }) instead', () => {
  // @ts-expect-error — Date is not in RawSqlLiteral; route it through param() with an explicit codecId
  const _v: RawSqlLiteral = new Date();
});

test('null is rejected', () => {
  // @ts-expect-error — null is not assignable to RawSqlLiteral
  const _v: RawSqlLiteral = null;
});

test('undefined is rejected', () => {
  // @ts-expect-error — undefined is not assignable to RawSqlLiteral
  const _v: RawSqlLiteral = undefined;
});

test('plain object is rejected', () => {
  // @ts-expect-error — plain object is not assignable to RawSqlLiteral
  const _v: RawSqlLiteral = { foo: 1 };
});

test('array is rejected', () => {
  // @ts-expect-error — array is not assignable to RawSqlLiteral
  const _v: RawSqlLiteral = [1, 2];
});

test('custom class instance is rejected', () => {
  class MyClass {
    value = 1;
  }
  // @ts-expect-error — class instance is not assignable to RawSqlLiteral
  const _v: RawSqlLiteral = new MyClass();
});
