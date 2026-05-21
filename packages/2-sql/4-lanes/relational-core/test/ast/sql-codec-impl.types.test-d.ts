/**
 * Negative type tests for the SQL codec construction factory.
 *
 * `SqlCodecImpl` declares `renderSqlLiteral` as an abstract method; subclasses that omit it are themselves abstract, and instantiating an abstract class with `new` is a compile-time error. This pins the SQL codec construction surface as the structural enforcement point for the codec-owned default-rendering contract.
 */

import type { JsonValue } from '@prisma-next/contract/types';
import type { AnyCodecDescriptor } from '@prisma-next/framework-components/codec';
import { test } from 'vitest';
import { SqlCodecImpl } from '../../src/ast/sql-codec-impl';

declare const fakeDescriptor: AnyCodecDescriptor;

class CompleteSqlCodec extends SqlCodecImpl<'demo/complete@1', readonly [], string, string> {
  override async encode(value: string): Promise<string> {
    return value;
  }
  override async decode(wire: string): Promise<string> {
    return wire;
  }
  override encodeJson(value: string): JsonValue {
    return value;
  }
  override decodeJson(json: JsonValue): string {
    return json as string;
  }
  override renderSqlLiteral(value: string): string {
    return `'${value}'`;
  }
}

// @ts-expect-error non-abstract subclass that omits the abstract `renderSqlLiteral` is a compile error (TS2515).
class IncompleteSqlCodec extends SqlCodecImpl<'demo/incomplete@1', readonly [], string, string> {
  override async encode(value: string): Promise<string> {
    return value;
  }
  override async decode(wire: string): Promise<string> {
    return wire;
  }
  override encodeJson(value: string): JsonValue {
    return value;
  }
  override decodeJson(json: JsonValue): string {
    return json as string;
  }
}

test('SqlCodecImpl admits construction when renderSqlLiteral is implemented', () => {
  // Positive case — every abstract member is implemented, so `new` is allowed.
  new CompleteSqlCodec(fakeDescriptor);
});

test('SqlCodecImpl rejects construction when renderSqlLiteral is omitted', () => {
  // Reference the rejected class so it isn't pruned; the compile-time assertion lives on its declaration.
  void IncompleteSqlCodec;
});
