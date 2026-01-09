import { describe, expect, it } from 'vitest';
import { vector, vectorColumn } from '../src/exports/column-types';

describe('pgvector column-types', () => {
  describe('vectorColumn (static)', () => {
    it('has correct codecId and nativeType', () => {
      expect(vectorColumn.codecId).toBe('pg/vector@1');
      expect(vectorColumn.nativeType).toBe('vector');
    });

    it('has no typeParams', () => {
      expect(vectorColumn).not.toHaveProperty('typeParams');
    });
  });

  describe('vector() factory', () => {
    it('creates descriptor with correct codecId', () => {
      const descriptor = vector(1536);
      expect(descriptor.codecId).toBe('pg/vector@1');
    });

    it('creates descriptor with dimensioned nativeType', () => {
      const descriptor = vector(1536);
      expect(descriptor.nativeType).toBe('vector(1536)');
    });

    it('creates descriptor with typeParams.length', () => {
      const descriptor = vector(1536);
      expect(descriptor.typeParams).toEqual({ length: 1536 });
    });

    it('preserves the dimension type parameter', () => {
      const descriptor768 = vector(768);
      const descriptor384 = vector(384);

      expect(descriptor768.nativeType).toBe('vector(768)');
      expect(descriptor768.typeParams.length).toBe(768);

      expect(descriptor384.nativeType).toBe('vector(384)');
      expect(descriptor384.typeParams.length).toBe(384);
    });

    it('works with OpenAI embedding dimensions', () => {
      const small = vector(1536);
      const large = vector(3072);

      expect(small.nativeType).toBe('vector(1536)');
      expect(small.typeParams).toEqual({ length: 1536 });

      expect(large.nativeType).toBe('vector(3072)');
      expect(large.typeParams).toEqual({ length: 3072 });
    });
  });
});
