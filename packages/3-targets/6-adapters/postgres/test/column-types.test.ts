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
    // Per Phase 4 of codec-registry-unification, json() / jsonb() are the
    // raw-JSONB column factories — they no longer accept a Standard Schema
    // for validation. Schema-typed JSON columns ship through per-library
    // extensions (e.g. `@prisma-next/extension-arktype-json`).
    it('returns the static raw-JSONB descriptor', () => {
      expect(json()).toEqual(jsonColumn);
    });
  });

  describe('jsonb()', () => {
    it('returns the static raw-JSONB descriptor', () => {
      expect(jsonb()).toEqual(jsonbColumn);
    });
  });
});
