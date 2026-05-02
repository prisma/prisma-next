import { describe, expect, it } from 'vitest';
import { codecDescriptorDefinitions } from '../src/core/codecs';

// `renderOutputType` is a `CodecDescriptor`-side concern after the SQL
// `Codec` narrow (TML-2357 M2 Phase B). Tests read the renderer from
// the descriptor list keyed by scalar.
function rendererFor(
  scalar: keyof typeof codecDescriptorDefinitions,
): ((typeParams: Record<string, unknown>) => string | undefined) | undefined {
  return codecDescriptorDefinitions[scalar].descriptor.renderOutputType as
    | ((typeParams: Record<string, unknown>) => string | undefined)
    | undefined;
}

describe('codec renderOutputType', () => {
  describe('pg/char@1', () => {
    const renderer = rendererFor('character');

    it('renders Char<length> when length is present', () => {
      expect(renderer?.({ length: 36 })).toBe('Char<36>');
    });

    it('returns undefined when length is absent', () => {
      expect(renderer?.({})).toBeUndefined();
    });

    it('throws on invalid length type', () => {
      expect(() => renderer?.({ length: 'bad' })).toThrow(/expected integer "length"/);
    });
  });

  describe('pg/varchar@1', () => {
    const renderer = rendererFor('character varying');

    it('renders Varchar<length>', () => {
      expect(renderer?.({ length: 255 })).toBe('Varchar<255>');
    });

    it('returns undefined when length is absent', () => {
      expect(renderer?.({})).toBeUndefined();
    });

    it('throws on invalid length type', () => {
      expect(() => renderer?.({ length: 'bad' })).toThrow(/expected integer "length"/);
    });
  });

  describe('sql/char@1', () => {
    const renderer = rendererFor('char');

    it('renders Char<length>', () => {
      expect(renderer?.({ length: 36 })).toBe('Char<36>');
    });
  });

  describe('sql/varchar@1', () => {
    const renderer = rendererFor('varchar');

    it('renders Varchar<length>', () => {
      expect(renderer?.({ length: 100 })).toBe('Varchar<100>');
    });
  });

  describe('pg/numeric@1', () => {
    const renderer = rendererFor('numeric');

    it('renders Numeric<P, S> when both precision and scale are present', () => {
      expect(renderer?.({ precision: 10, scale: 2 })).toBe('Numeric<10, 2>');
    });

    it('renders Numeric<P> when only precision is present', () => {
      expect(renderer?.({ precision: 10 })).toBe('Numeric<10>');
    });

    it('returns undefined when precision is absent', () => {
      expect(renderer?.({})).toBeUndefined();
    });
  });

  describe('pg/bit@1', () => {
    const renderer = rendererFor('bit');

    it('renders Bit<length>', () => {
      expect(renderer?.({ length: 8 })).toBe('Bit<8>');
    });

    it('returns undefined when length is absent', () => {
      expect(renderer?.({})).toBeUndefined();
    });
  });

  describe('pg/varbit@1', () => {
    const renderer = rendererFor('bit varying');

    it('renders VarBit<length>', () => {
      expect(renderer?.({ length: 16 })).toBe('VarBit<16>');
    });
  });

  describe('pg/timestamp@1', () => {
    const renderer = rendererFor('timestamp');

    it('renders Timestamp<P> when precision is present', () => {
      expect(renderer?.({ precision: 3 })).toBe('Timestamp<3>');
    });

    it('renders Timestamp when precision is missing', () => {
      expect(renderer?.({})).toBe('Timestamp');
    });
  });

  describe('pg/timestamptz@1', () => {
    const renderer = rendererFor('timestamptz');

    it('renders Timestamptz<P>', () => {
      expect(renderer?.({ precision: 6 })).toBe('Timestamptz<6>');
    });

    it('renders Timestamptz when precision is missing', () => {
      expect(renderer?.({})).toBe('Timestamptz');
    });
  });

  describe('pg/time@1', () => {
    const renderer = rendererFor('time');

    it('renders Time<P>', () => {
      expect(renderer?.({ precision: 0 })).toBe('Time<0>');
    });
  });

  describe('pg/timetz@1', () => {
    const renderer = rendererFor('timetz');

    it('renders Timetz<P>', () => {
      expect(renderer?.({ precision: 3 })).toBe('Timetz<3>');
    });
  });

  describe('pg/interval@1', () => {
    const renderer = rendererFor('interval');

    it('renders Interval<P>', () => {
      expect(renderer?.({ precision: 3 })).toBe('Interval<3>');
    });
  });

  describe('pg/enum@1', () => {
    const renderer = rendererFor('enum');

    it('renders literal union from values', () => {
      expect(renderer?.({ values: ['USER', 'ADMIN'] })).toBe("'USER' | 'ADMIN'");
    });

    it('escapes backslashes before single quotes', () => {
      expect(renderer?.({ values: ["it's", 'back\\slash'] })).toBe("'it\\'s' | 'back\\\\slash'");
    });

    it('throws when values is missing', () => {
      expect(() => renderer?.({})).toThrow(/expected array "values"/);
    });
  });

  // Phase C: pg/json@1 and pg/jsonb@1 no longer carry renderOutputType.
  // The schema-typed JSON column surface that drove typeParams.schemaJson
  // / typeParams.type retired in favor of the per-library extension
  // (`@prisma-next/extension-arktype-json`). Untyped raw json/jsonb
  // columns have no typeParams; the framework emit path falls through to
  // the generic CodecTypes accessor.
  describe('pg/jsonb@1', () => {
    it('has no renderOutputType (raw JSONB)', () => {
      expect(rendererFor('jsonb')).toBeUndefined();
    });
  });

  describe('pg/json@1', () => {
    it('has no renderOutputType (raw JSON)', () => {
      expect(rendererFor('json')).toBeUndefined();
    });
  });

  describe('non-parameterized codecs', () => {
    it('pg/int4@1 has no renderOutputType', () => {
      expect(rendererFor('int4')).toBeUndefined();
    });

    it('pg/text@1 has no renderOutputType', () => {
      expect(rendererFor('text')).toBeUndefined();
    });

    it('pg/bool@1 has no renderOutputType', () => {
      expect(rendererFor('bool')).toBeUndefined();
    });
  });
});
