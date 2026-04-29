import { timeouts } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import {
  allPostgresParameterizedCodecs,
  pgBitCodec,
  pgCharCodec,
  pgEnumCodec,
  pgIntervalCodec,
  pgJsonbLegacyCodec,
  pgJsonLegacyCodec,
  pgNumericCodec,
  pgTimeCodec,
  pgTimestampCodec,
  pgTimestamptzCodec,
  pgTimetzCodec,
  pgVarbitCodec,
  pgVarcharCodec,
  sqlCharCodec,
  sqlVarcharCodec,
} from '../src/codecs/postgres-codec-descriptors';

// `renderOutputType` lives on `ParameterizedCodecDescriptor.renderOutputType`
// rather than on the codec object; the descriptor's `paramsSchema` validates
// inputs upstream of the renderer, so tests below assert the renderer's output
// for valid inputs only. See ADR 205.
describe('parameterized codec descriptor renderOutputType', () => {
  describe('pg/char@1', () => {
    it('renders Char<length>', () => {
      expect(pgCharCodec.renderOutputType!({ length: 36 })).toBe('Char<36>');
    });
  });

  describe('pg/varchar@1', () => {
    it('renders Varchar<length>', () => {
      expect(pgVarcharCodec.renderOutputType!({ length: 255 })).toBe('Varchar<255>');
    });
  });

  describe('sql/char@1', () => {
    it('renders Char<length>', () => {
      expect(sqlCharCodec.renderOutputType!({ length: 36 })).toBe('Char<36>');
    });
  });

  describe('sql/varchar@1', () => {
    it('renders Varchar<length>', () => {
      expect(sqlVarcharCodec.renderOutputType!({ length: 100 })).toBe('Varchar<100>');
    });
  });

  describe('pg/numeric@1', () => {
    it('renders Numeric<P, S> when both precision and scale are present', () => {
      expect(pgNumericCodec.renderOutputType!({ precision: 10, scale: 2 })).toBe('Numeric<10, 2>');
    });

    it('renders Numeric<P> when only precision is present', () => {
      expect(pgNumericCodec.renderOutputType!({ precision: 10 })).toBe('Numeric<10>');
    });
  });

  describe('pg/bit@1', () => {
    it('renders Bit<length>', () => {
      expect(pgBitCodec.renderOutputType!({ length: 8 })).toBe('Bit<8>');
    });
  });

  describe('pg/varbit@1', () => {
    it('renders VarBit<length>', () => {
      expect(pgVarbitCodec.renderOutputType!({ length: 16 })).toBe('VarBit<16>');
    });
  });

  describe('pg/timestamp@1', () => {
    it('renders Timestamp<P> when precision is present', () => {
      expect(pgTimestampCodec.renderOutputType!({ precision: 3 })).toBe('Timestamp<3>');
    });

    it('renders Timestamp when precision is missing', () => {
      expect(pgTimestampCodec.renderOutputType!({})).toBe('Timestamp');
    });
  });

  describe('pg/timestamptz@1', () => {
    it('renders Timestamptz<P>', () => {
      expect(pgTimestamptzCodec.renderOutputType!({ precision: 6 })).toBe('Timestamptz<6>');
    });

    it('renders Timestamptz when precision is missing', () => {
      expect(pgTimestamptzCodec.renderOutputType!({})).toBe('Timestamptz');
    });
  });

  describe('pg/time@1', () => {
    it('renders Time<P>', () => {
      expect(pgTimeCodec.renderOutputType!({ precision: 0 })).toBe('Time<0>');
    });
  });

  describe('pg/timetz@1', () => {
    it('renders Timetz<P>', () => {
      expect(pgTimetzCodec.renderOutputType!({ precision: 3 })).toBe('Timetz<3>');
    });
  });

  describe('pg/interval@1', () => {
    it('renders Interval<P>', () => {
      expect(pgIntervalCodec.renderOutputType!({ precision: 3 })).toBe('Interval<3>');
    });
  });

  describe('pg/enum@1', () => {
    it('renders literal union from values', () => {
      expect(pgEnumCodec.renderOutputType!({ values: ['USER', 'ADMIN'] })).toBe("'USER' | 'ADMIN'");
    });

    it('escapes backslashes before single quotes', () => {
      expect(pgEnumCodec.renderOutputType!({ values: ["it's", 'back\\slash'] })).toBe(
        "'it\\'s' | 'back\\\\slash'",
      );
    });
  });

  describe('pg/jsonb@1 (legacy serialized typeParams)', () => {
    it('renders type expression from schemaJson', () => {
      const result = pgJsonbLegacyCodec.renderOutputType!({
        schemaJson: {
          type: 'object',
          properties: { name: { type: 'string' } },
          required: ['name'],
        },
      });
      expect(result).toBe('{ name: string }');
    });

    it('renders type name from type param', () => {
      expect(pgJsonbLegacyCodec.renderOutputType!({ type: 'AuditPayload' })).toBe('AuditPayload');
    });
  });

  describe('pg/json@1 (legacy serialized typeParams)', () => {
    it(
      'renders type expression from schemaJson',
      () => {
        const result = pgJsonLegacyCodec.renderOutputType!({
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

  describe('descriptor registry', () => {
    it('allPostgresParameterizedCodecs contains every parameterized Postgres codec id', () => {
      const ids = new Set(allPostgresParameterizedCodecs.map((d) => d.codecId));
      expect(ids).toContain('pg/char@1');
      expect(ids).toContain('pg/varchar@1');
      expect(ids).toContain('pg/numeric@1');
      expect(ids).toContain('pg/bit@1');
      expect(ids).toContain('pg/varbit@1');
      expect(ids).toContain('pg/timestamp@1');
      expect(ids).toContain('pg/timestamptz@1');
      expect(ids).toContain('pg/time@1');
      expect(ids).toContain('pg/timetz@1');
      expect(ids).toContain('pg/interval@1');
      expect(ids).toContain('pg/enum@1');
    });
  });
});
