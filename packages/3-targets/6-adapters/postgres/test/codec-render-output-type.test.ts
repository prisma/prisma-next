import { timeouts } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import { codecDefinitions } from '../src/core/codecs';

describe('codec renderOutputType', () => {
  describe('pg/char@1', () => {
    const codec = codecDefinitions['character'].codec;

    it('renders Char<length> when length is present', () => {
      expect(codec.renderOutputType!({ length: 36 })).toBe('Char<36>');
    });

    it('returns undefined when length is absent', () => {
      expect(codec.renderOutputType!({})).toBeUndefined();
    });

    it('throws on invalid length type', () => {
      expect(() => codec.renderOutputType!({ length: 'bad' })).toThrow(/expected integer "length"/);
    });
  });

  describe('pg/varchar@1', () => {
    const codec = codecDefinitions['character varying'].codec;

    it('renders Varchar<length>', () => {
      expect(codec.renderOutputType!({ length: 255 })).toBe('Varchar<255>');
    });

    it('returns undefined when length is absent', () => {
      expect(codec.renderOutputType!({})).toBeUndefined();
    });

    it('throws on invalid length type', () => {
      expect(() => codec.renderOutputType!({ length: 'bad' })).toThrow(/expected integer "length"/);
    });
  });

  describe('sql/char@1', () => {
    const codec = codecDefinitions['char'].codec;

    it('renders Char<length>', () => {
      expect(codec.renderOutputType!({ length: 36 })).toBe('Char<36>');
    });
  });

  describe('sql/varchar@1', () => {
    const codec = codecDefinitions['varchar'].codec;

    it('renders Varchar<length>', () => {
      expect(codec.renderOutputType!({ length: 100 })).toBe('Varchar<100>');
    });
  });

  describe('pg/numeric@1', () => {
    const codec = codecDefinitions['numeric'].codec;

    it('renders Numeric<P, S> when both precision and scale are present', () => {
      expect(codec.renderOutputType!({ precision: 10, scale: 2 })).toBe('Numeric<10, 2>');
    });

    it('renders Numeric<P> when only precision is present', () => {
      expect(codec.renderOutputType!({ precision: 10 })).toBe('Numeric<10>');
    });

    it('returns undefined when precision is absent', () => {
      expect(codec.renderOutputType!({})).toBeUndefined();
    });
  });

  describe('pg/bit@1', () => {
    const codec = codecDefinitions['bit'].codec;

    it('renders Bit<length>', () => {
      expect(codec.renderOutputType!({ length: 8 })).toBe('Bit<8>');
    });

    it('returns undefined when length is absent', () => {
      expect(codec.renderOutputType!({})).toBeUndefined();
    });
  });

  describe('pg/varbit@1', () => {
    const codec = codecDefinitions['bit varying'].codec;

    it('renders VarBit<length>', () => {
      expect(codec.renderOutputType!({ length: 16 })).toBe('VarBit<16>');
    });
  });

  describe('pg/timestamp@1', () => {
    const codec = codecDefinitions['timestamp'].codec;

    it('renders Timestamp<P> when precision is present', () => {
      expect(codec.renderOutputType!({ precision: 3 })).toBe('Timestamp<3>');
    });

    it('renders Timestamp when precision is missing', () => {
      expect(codec.renderOutputType!({})).toBe('Timestamp');
    });
  });

  describe('pg/timestamptz@1', () => {
    const codec = codecDefinitions['timestamptz'].codec;

    it('renders Timestamptz<P>', () => {
      expect(codec.renderOutputType!({ precision: 6 })).toBe('Timestamptz<6>');
    });

    it('renders Timestamptz when precision is missing', () => {
      expect(codec.renderOutputType!({})).toBe('Timestamptz');
    });
  });

  describe('pg/time@1', () => {
    const codec = codecDefinitions['time'].codec;

    it('renders Time<P>', () => {
      expect(codec.renderOutputType!({ precision: 0 })).toBe('Time<0>');
    });
  });

  describe('pg/timetz@1', () => {
    const codec = codecDefinitions['timetz'].codec;

    it('renders Timetz<P>', () => {
      expect(codec.renderOutputType!({ precision: 3 })).toBe('Timetz<3>');
    });
  });

  describe('pg/interval@1', () => {
    const codec = codecDefinitions['interval'].codec;

    it('renders Interval<P>', () => {
      expect(codec.renderOutputType!({ precision: 3 })).toBe('Interval<3>');
    });
  });

  describe('pg/enum@1', () => {
    const codec = codecDefinitions['enum'].codec;

    it('renders literal union from values', () => {
      expect(codec.renderOutputType!({ values: ['USER', 'ADMIN'] })).toBe("'USER' | 'ADMIN'");
    });

    it('escapes backslashes before single quotes', () => {
      expect(codec.renderOutputType!({ values: ["it's", 'back\\slash'] })).toBe(
        "'it\\'s' | 'back\\\\slash'",
      );
    });

    it('throws when values is missing', () => {
      expect(() => codec.renderOutputType!({})).toThrow(/expected array "values"/);
    });
  });

  describe('pg/jsonb@1', () => {
    const codec = codecDefinitions['jsonb'].codec;

    it('renders type expression from schemaJson', () => {
      const result = codec.renderOutputType!({
        schemaJson: {
          type: 'object',
          properties: { name: { type: 'string' } },
          required: ['name'],
        },
      });
      expect(result).toBe('{ name: string }');
    });

    it('renders type name from type param', () => {
      expect(codec.renderOutputType!({ type: 'AuditPayload' })).toBe('AuditPayload');
    });

    it('throws when no type or schemaJson', () => {
      expect(() => codec.renderOutputType!({})).toThrow(/JSON codec typeParams/);
    });
  });

  describe('pg/json@1', () => {
    const codec = codecDefinitions['json'].codec;

    it(
      'renders type expression from schemaJson',
      () => {
        const result = codec.renderOutputType!({
          schemaJson: {
            type: 'object',
            properties: { action: { type: 'string' }, actorId: { type: 'number' } },
            required: ['action', 'actorId'],
          },
        });
        expect(result).toBe('{ action: string; actorId: number }');
      },
      timeouts.databaseOperation,
    );
  });

  describe('non-parameterized codecs', () => {
    it('pg/int4@1 has no renderOutputType', () => {
      const codec = codecDefinitions['int4'].codec;
      expect(codec.renderOutputType).toBeUndefined();
    });

    it('pg/text@1 has no renderOutputType', () => {
      const codec = codecDefinitions['text'].codec;
      expect(codec.renderOutputType).toBeUndefined();
    });

    it('pg/bool@1 has no renderOutputType', () => {
      const codec = codecDefinitions['bool'].codec;
      expect(codec.renderOutputType).toBeUndefined();
    });
  });
});
