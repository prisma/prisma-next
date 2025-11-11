import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadExtensionPackManifest, loadExtensionPacks } from '../src/extension-pack';

describe('extension-pack', () => {
  it('loads valid manifest', () => {
    const manifest = loadExtensionPackManifest(
      join(__dirname, '../../../../../packages/sql/runtime/adapters/postgres'),
    );
    expect(manifest.id).toBe('postgres');
    expect(manifest.version).toBe('15.0.0');
    expect(manifest.types?.codecTypes?.import.package).toBe(
      '@prisma-next/adapter-postgres/codec-types',
    );
  });

  it('loads extension packs with adapter first', () => {
    const packs = loadExtensionPacks(
      join(__dirname, '../../../../../packages/sql/runtime/adapters/postgres'),
      [],
    );
    expect(packs.length).toBe(1);
    expect(packs[0]?.manifest.id).toBe('postgres');
  });

  it('throws error for invalid manifest', () => {
    expect(() => {
      loadExtensionPackManifest('/nonexistent/path');
    }).toThrow();
  });

  it('loads extension packs with multiple extensions', () => {
    const packs = loadExtensionPacks(
      join(__dirname, '../../../../../packages/sql/runtime/adapters/postgres'),
      [join(__dirname, '../../../../../packages/sql/runtime/adapters/postgres')],
    );
    expect(packs.length).toBe(2);
    expect(packs[0]?.manifest.id).toBe('postgres');
    expect(packs[1]?.manifest.id).toBe('postgres');
  });

  it('loads extension packs without adapter', () => {
    const packs = loadExtensionPacks(undefined, []);
    expect(packs.length).toBe(0);
  });

  it('handles extension pack loading errors', () => {
    expect(() => {
      loadExtensionPacks(undefined, ['/nonexistent/path']);
    }).toThrow();
  });
});
