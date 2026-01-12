/**
 * Type-level tests for enum result type inference.
 *
 * These tests verify that:
 * 1. CodecTypes exposes parameterizedOutput for pg/enum@1
 * 2. The base output type is string
 */
import { expectTypeOf, test } from 'vitest';
import type { CodecTypes } from '../src/types/codec-types';

test('CodecTypes exposes pg/enum@1 with correct structure', () => {
  type EnumCodecType = CodecTypes['pg/enum@1'];

  // Verify scalar output is string (for runtime compatibility)
  expectTypeOf({} as EnumCodecType).toHaveProperty('output');
  expectTypeOf({} as EnumCodecType['output']).toEqualTypeOf<string>();

  // Verify parameterizedOutput is present
  expectTypeOf({} as EnumCodecType).toHaveProperty('parameterizedOutput');
});

test('enum codec base output is string', () => {
  type EnumCodecType = CodecTypes['pg/enum@1'];

  // The base output type is string (used when typeParams are not available)
  expectTypeOf<EnumCodecType['output']>().toEqualTypeOf<string>();
});
