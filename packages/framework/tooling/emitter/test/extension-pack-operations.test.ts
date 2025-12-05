import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadExtensionPackManifest } from '../../cli/src/pack-loading';

describe('ExtensionPackManifest with operations', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `prisma-next-test-${Date.now()}`);
    await mkdir(join(tempDir, 'packs'), { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('loads manifest with operations array', async () => {
    const manifest = {
      id: 'pgvector',
      version: '1.2.0',
      operations: [
        {
          for: 'pg/vector@1',
          method: 'cosineDistance',
          args: [{ kind: 'typeId', type: 'pg/vector@1' }],
          returns: { kind: 'builtin', type: 'number' },
          lowering: {
            targetFamily: 'sql',
            strategy: 'infix',
            // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
            template: '${self} <=> ${arg0}',
          },
        },
      ],
    };

    await writeFile(join(tempDir, 'packs', 'manifest.json'), JSON.stringify(manifest, null, 2));

    const loaded = loadExtensionPackManifest(tempDir);
    expect(loaded.operations).toBeDefined();
    expect(loaded.operations).toHaveLength(1);
    expect(loaded.operations?.[0]?.for).toBe('pg/vector@1');
    expect(loaded.operations?.[0]?.method).toBe('cosineDistance');
  });

  it('loads manifest without operations field', async () => {
    const manifest = {
      id: 'postgres',
      version: '15.0.0',
    };

    await writeFile(join(tempDir, 'packs', 'manifest.json'), JSON.stringify(manifest, null, 2));

    const loaded = loadExtensionPackManifest(tempDir);
    expect(loaded.operations).toBeUndefined();
  });

  it('loads manifest with multiple operations', async () => {
    const manifest = {
      id: 'pgvector',
      version: '1.2.0',
      operations: [
        {
          for: 'pg/vector@1',
          method: 'cosineDistance',
          args: [{ kind: 'typeId', type: 'pg/vector@1' }],
          returns: { kind: 'builtin', type: 'number' },
          lowering: {
            targetFamily: 'sql',
            strategy: 'infix',
            // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
            template: '${self} <=> ${arg0}',
          },
        },
        {
          for: 'pg/vector@1',
          method: 'l2Distance',
          args: [{ kind: 'typeId', type: 'pg/vector@1' }],
          returns: { kind: 'builtin', type: 'number' },
          lowering: {
            targetFamily: 'sql',
            strategy: 'infix',
            // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
            template: '${self} <-> ${arg0}',
          },
        },
      ],
    };

    await writeFile(join(tempDir, 'packs', 'manifest.json'), JSON.stringify(manifest, null, 2));

    const loaded = loadExtensionPackManifest(tempDir);
    expect(loaded.operations).toHaveLength(2);
  });

  it('loads manifest with operation capabilities', async () => {
    const manifest = {
      id: 'pgvector',
      version: '1.2.0',
      operations: [
        {
          for: 'pg/vector@1',
          method: 'cosineDistance',
          args: [{ kind: 'typeId', type: 'pg/vector@1' }],
          returns: { kind: 'builtin', type: 'number' },
          lowering: {
            targetFamily: 'sql',
            strategy: 'infix',
            // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
            template: '${self} <=> ${arg0}',
          },
          capabilities: ['pgvector.index.ivfflat'],
        },
      ],
    };

    await writeFile(join(tempDir, 'packs', 'manifest.json'), JSON.stringify(manifest, null, 2));

    const loaded = loadExtensionPackManifest(tempDir);
    expect(loaded.operations?.[0]?.capabilities).toEqual(['pgvector.index.ivfflat']);
  });

  it('loads manifest with operation using param argument', async () => {
    const manifest = {
      id: 'pgvector',
      version: '1.2.0',
      operations: [
        {
          for: 'pg/vector@1',
          method: 'cosineDistance',
          args: [{ kind: 'param' }],
          returns: { kind: 'builtin', type: 'number' },
          lowering: {
            targetFamily: 'sql',
            strategy: 'infix',
            // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
            template: '${self} <=> ${arg0}',
          },
        },
      ],
    };

    await writeFile(join(tempDir, 'packs', 'manifest.json'), JSON.stringify(manifest, null, 2));

    const loaded = loadExtensionPackManifest(tempDir);
    expect(loaded.operations?.[0]?.args[0]).toEqual({ kind: 'param' });
  });

  it('loads manifest with operation using literal argument', async () => {
    const manifest = {
      id: 'pgvector',
      version: '1.2.0',
      operations: [
        {
          for: 'pg/vector@1',
          method: 'cosineDistance',
          args: [{ kind: 'literal' }],
          returns: { kind: 'builtin', type: 'number' },
          lowering: {
            targetFamily: 'sql',
            strategy: 'infix',
            // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
            template: '${self} <=> ${arg0}',
          },
        },
      ],
    };

    await writeFile(join(tempDir, 'packs', 'manifest.json'), JSON.stringify(manifest, null, 2));

    const loaded = loadExtensionPackManifest(tempDir);
    expect(loaded.operations?.[0]?.args[0]).toEqual({ kind: 'literal' });
  });

  it('loads manifest with operation using typeId return type', async () => {
    const manifest = {
      id: 'pgvector',
      version: '1.2.0',
      operations: [
        {
          for: 'pg/vector@1',
          method: 'normalize',
          args: [],
          returns: { kind: 'typeId', type: 'pg/vector@1' },
          lowering: {
            targetFamily: 'sql',
            strategy: 'function',
            // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
            template: 'normalize(${self})',
          },
        },
      ],
    };

    await writeFile(join(tempDir, 'packs', 'manifest.json'), JSON.stringify(manifest, null, 2));

    const loaded = loadExtensionPackManifest(tempDir);
    expect(loaded.operations?.[0]?.returns).toEqual({
      kind: 'typeId',
      type: 'pg/vector@1',
    });
  });

  it('throws error for invalid operation structure', async () => {
    const manifest = {
      id: 'pgvector',
      version: '1.2.0',
      operations: [
        {
          for: 'pg/vector@1',
          method: 'cosineDistance',
          args: [{ kind: 'invalid' }],
          returns: { kind: 'builtin', type: 'number' },
          lowering: {
            targetFamily: 'sql',
            strategy: 'infix',
            // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
            template: '${self} <=> ${arg0}',
          },
        },
      ],
    };

    await writeFile(join(tempDir, 'packs', 'manifest.json'), JSON.stringify(manifest, null, 2));

    expect(() => {
      loadExtensionPackManifest(tempDir);
    }).toThrow();
  });
});
