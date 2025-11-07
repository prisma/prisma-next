import type { Codec } from '@prisma-next/sql-target';
import { type CodecRegistry, createCodecRegistry } from '@prisma-next/sql-target';
import { describe, expect, it } from 'vitest';
import { codecDefinitions } from '../../adapter-postgres/src/codecs';

function createRegistry(): CodecRegistry {
  const registry = createCodecRegistry();
  for (const definition of Object.values(codecDefinitions)) {
    registry.register(definition.codec);
  }
  return registry;
}

describe('Codec Registry', () => {
  const registry = createRegistry();

  it('resolves codec by ID using get()', () => {
    const codec = registry.get('pg/text@1');
    expect(codec).toBeDefined();
    expect(codec?.id).toBe('pg/text@1');
  });

  it('checks if codec exists using has()', () => {
    expect(registry.has('pg/text@1')).toBe(true);
    expect(registry.has('pg/nonexistent@1')).toBe(false);
  });

  it('resolves codec by scalar type using getByScalar()', () => {
    const codecs = registry.getByScalar('text');
    expect(codecs).toBeDefined();
    expect(codecs.length).toBeGreaterThan(0);
    expect(codecs[0]?.id).toBe('pg/text@1');
  });

  it('returns empty array for unknown scalar type using getByScalar()', () => {
    const codecs = registry.getByScalar('unknown-type');
    expect(codecs).toEqual([]);
  });

  it('gets default codec for scalar type', () => {
    const codec = registry.getDefaultCodec('text');
    expect(codec).toBeDefined();
    expect(codec?.id).toBe('pg/text@1');
  });

  it('returns undefined for default codec of unknown scalar type', () => {
    const codec = registry.getDefaultCodec('unknown-type');
    expect(codec).toBeUndefined();
  });

  it('returns multiple codecs for same scalar type', () => {
    const timestamptzCodecs = registry.getByScalar('timestamptz');
    expect(timestamptzCodecs).toBeDefined();
    expect(timestamptzCodecs.length).toBeGreaterThan(0);
  });

  it('iterates over all codecs', () => {
    const codecs = Array.from(registry.values());
    expect(codecs.length).toBeGreaterThan(0);
    expect(codecs.some((c) => c.id === 'pg/text@1')).toBe(true);
  });

  describe('CodecRegistry class methods', () => {
    it('registers a new codec', () => {
      const newRegistry = createCodecRegistry();
      const codec: Codec<string, string, string> = {
        id: 'test/custom@1',
        targetTypes: ['custom'],
        decode: (wire: string) => wire,
        encode: (value: string) => value,
      };

      newRegistry.register(codec);
      expect(newRegistry.get('test/custom@1')).toBe(codec);
      expect(newRegistry.has('test/custom@1')).toBe(true);
    });

    it('throws error when registering duplicate codec ID', () => {
      const newRegistry = createCodecRegistry();
      const codec: Codec<string, string, string> = {
        id: 'test/duplicate@1',
        targetTypes: ['custom'],
        decode: (wire) => wire,
      };

      newRegistry.register(codec);
      expect(() => {
        newRegistry.register(codec);
      }).toThrow("Codec with ID 'test/duplicate@1' is already registered");
    });

    it('maintains codec order for scalar types', () => {
      const newRegistry = createCodecRegistry();
      const codec1: Codec<string, string> = {
        id: 'test/first@1',
        targetTypes: ['shared'],
        decode: (wire) => wire,
      };
      const codec2: Codec<string, string> = {
        id: 'test/second@1',
        targetTypes: ['shared'],
        decode: (wire) => wire,
      };

      newRegistry.register(codec1);
      newRegistry.register(codec2);

      const codecs = newRegistry.getByScalar('shared');
      expect(codecs.length).toBe(2);
      expect(codecs[0]?.id).toBe('test/first@1');
      expect(codecs[1]?.id).toBe('test/second@1');
      expect(newRegistry.getDefaultCodec('shared')?.id).toBe('test/first@1');
    });
  });
});

