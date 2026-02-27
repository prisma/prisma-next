import { describe, expect, it } from 'vitest';
import { paradedbPackMeta } from '../src/core/descriptor-meta';
import { bm25 } from '../src/types/index-types';

describe('ParadeDB extension', () => {
  describe('paradedbPackMeta', () => {
    it('declares correct extension identity', () => {
      expect(paradedbPackMeta.kind).toBe('extension');
      expect(paradedbPackMeta.id).toBe('paradedb');
      expect(paradedbPackMeta.familyId).toBe('sql');
      expect(paradedbPackMeta.targetId).toBe('postgres');
    });

    it('declares bm25 capability', () => {
      expect(paradedbPackMeta.capabilities).toEqual({
        postgres: { 'paradedb/bm25': true },
      });
    });
  });

  describe('bm25 field builders', () => {
    describe('bm25.text', () => {
      it('creates a text field with defaults', () => {
        expect(bm25.text('description')).toEqual({ column: 'description' });
      });

      it('creates a text field with tokenizer', () => {
        expect(bm25.text('description', { tokenizer: 'simple' })).toEqual({
          column: 'description',
          tokenizer: 'simple',
        });
      });

      it('creates a text field with stemmer', () => {
        expect(bm25.text('description', { tokenizer: 'simple', stemmer: 'english' })).toEqual({
          column: 'description',
          tokenizer: 'simple',
          tokenizerParams: { stemmer: 'english' },
        });
      });

      it('creates a text field with remove_emojis', () => {
        expect(bm25.text('description', { tokenizer: 'unicode', remove_emojis: true })).toEqual({
          column: 'description',
          tokenizer: 'unicode',
          tokenizerParams: { remove_emojis: true },
        });
      });

      it('creates a text field with alias for multi-tokenizer', () => {
        expect(
          bm25.text('description', { tokenizer: 'simple', alias: 'description_simple' }),
        ).toEqual({
          column: 'description',
          tokenizer: 'simple',
          alias: 'description_simple',
        });
      });
    });

    describe('bm25.numeric', () => {
      it('creates a numeric field', () => {
        expect(bm25.numeric('rating')).toEqual({ column: 'rating' });
      });
    });

    describe('bm25.boolean', () => {
      it('creates a boolean field', () => {
        expect(bm25.boolean('active')).toEqual({ column: 'active' });
      });
    });

    describe('bm25.json', () => {
      it('creates a json field with defaults', () => {
        expect(bm25.json('metadata')).toEqual({ column: 'metadata' });
      });

      it('creates a json field with ngram tokenizer', () => {
        expect(bm25.json('metadata', { tokenizer: 'ngram', min: 2, max: 3 })).toEqual({
          column: 'metadata',
          tokenizer: 'ngram',
          tokenizerParams: { min: 2, max: 3 },
        });
      });
    });

    describe('bm25.datetime', () => {
      it('creates a datetime field', () => {
        expect(bm25.datetime('created_at')).toEqual({ column: 'created_at' });
      });
    });

    describe('bm25.range', () => {
      it('creates a range field', () => {
        expect(bm25.range('price_range')).toEqual({ column: 'price_range' });
      });
    });

    describe('bm25.expression', () => {
      it('creates an expression field with alias', () => {
        expect(
          bm25.expression("description || ' ' || category", {
            alias: 'concat',
            tokenizer: 'simple',
          }),
        ).toEqual({
          expression: "description || ' ' || category",
          alias: 'concat',
          tokenizer: 'simple',
        });
      });

      it('creates expression field with tokenizer params', () => {
        expect(
          bm25.expression("(metadata->>'color')", {
            alias: 'meta_color',
            tokenizer: 'ngram',
            min: 2,
            max: 3,
          }),
        ).toEqual({
          expression: "(metadata->>'color')",
          alias: 'meta_color',
          tokenizer: 'ngram',
          tokenizerParams: { min: 2, max: 3 },
        });
      });

      it('creates expression field without tokenizer', () => {
        expect(bm25.expression('rating + 1', { alias: 'rating_plus' })).toEqual({
          expression: 'rating + 1',
          alias: 'rating_plus',
        });
      });
    });
  });
});
