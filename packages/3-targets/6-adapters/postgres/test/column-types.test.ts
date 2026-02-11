import { type as arktype } from 'arktype';
import { describe, expect, it } from 'vitest';
import { json, jsonb, jsonbColumn, jsonColumn } from '../src/exports/column-types';

describe('adapter-postgres column-types', () => {
  describe('jsonColumn', () => {
    it('has expected codec and native type', () => {
      expect(jsonColumn).toMatchObject({
        codecId: 'pg/json@1',
        nativeType: 'json',
      });
    });
  });

  describe('jsonbColumn', () => {
    it('has expected codec and native type', () => {
      expect(jsonbColumn).toMatchObject({
        codecId: 'pg/jsonb@1',
        nativeType: 'jsonb',
      });
    });
  });

  describe('json()', () => {
    it('returns static descriptor when no schema is provided', () => {
      expect(json()).toEqual(jsonColumn);
    });

    it('attaches standard-schema output in typeParams', () => {
      const descriptor = json(
        arktype({
          action: 'string',
          actorId: 'number',
        }),
      );
      expect(descriptor).toMatchObject({
        codecId: 'pg/json@1',
        nativeType: 'json',
        typeParams: {
          schema: expect.objectContaining({
            type: 'object',
          }),
        },
      });
    });
  });

  describe('jsonb()', () => {
    it('returns static descriptor when no schema is provided', () => {
      expect(jsonb()).toEqual(jsonbColumn);
    });

    it('attaches standard-schema output in typeParams', () => {
      const descriptor = jsonb(
        arktype({
          source: 'string',
          rank: 'number',
        }),
      );
      expect(descriptor).toMatchObject({
        codecId: 'pg/jsonb@1',
        nativeType: 'jsonb',
        typeParams: {
          schema: expect.objectContaining({
            type: 'object',
          }),
        },
      });
    });
  });
});
