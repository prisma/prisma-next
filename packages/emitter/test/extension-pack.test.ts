import { describe, it, expect } from 'vitest';
import { loadExtensionPackManifest, loadExtensionPacks } from '../src/extension-pack';
import { join } from 'node:path';

describe('extension-pack', () => {
  it('loads valid manifest', () => {
    const manifest = loadExtensionPackManifest(join(__dirname, '../../adapter-postgres'));
    expect(manifest.id).toBe('postgres');
    expect(manifest.version).toBe('15.0.0');
    expect(manifest.types?.codecTypes?.import.package).toBe('@prisma-next/adapter-postgres/codec-types');
  });

  it('loads extension packs with adapter first', () => {
    const packs = loadExtensionPacks(
      join(__dirname, '../../adapter-postgres'),
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
});

