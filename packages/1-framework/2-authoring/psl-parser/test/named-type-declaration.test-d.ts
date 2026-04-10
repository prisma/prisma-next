import { expectTypeOf, test } from 'vitest';
import type { PslNamedTypeDeclaration, PslTypeConstructorCall } from '../src/types';

const malformedDeclaration = {
  kind: 'namedType',
  name: 'Broken',
  attributes: [],
  span: {
    start: { line: 1, column: 1, offset: 0 },
    end: { line: 1, column: 7, offset: 6 },
  },
} satisfies PslNamedTypeDeclaration;

test('named type declarations leave the parser invariant to downstream runtime guards', () => {
  expectTypeOf(malformedDeclaration.baseType).toEqualTypeOf<string | undefined>();
  expectTypeOf(malformedDeclaration.typeConstructor).toEqualTypeOf<
    PslTypeConstructorCall | undefined
  >();
});
