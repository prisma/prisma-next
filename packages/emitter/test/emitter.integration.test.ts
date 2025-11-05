import { describe, it, expect, beforeEach } from 'vitest';
import { emit } from '../src/emitter';
import { targetFamilyRegistry } from '../src/target-family-registry';
import { sqlTargetFamilyHook } from '@prisma-next/sql-target';
import type { ContractIR, EmitOptions } from '../src/types';
import { join } from 'node:path';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

describe('emitter integration', () => {
  beforeEach(() => {
    if (!targetFamilyRegistry.has('sql')) {
      targetFamilyRegistry.register(sqlTargetFamilyHook);
    }
  });

  it('emits complete contract from IR to artifacts', async () => {
    const ir: ContractIR = {
      schemaVersion: '1',
      targetFamily: 'sql',
      target: 'postgres',
      models: {
        User: {
          storage: { table: 'user' },
          fields: {
            id: { column: 'id' },
            email: { column: 'email' },
          },
        },
      },
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'int4', nullable: false },
              email: { type: 'text', nullable: false },
            },
            primaryKey: { columns: ['id'] },
          },
        },
      },
    };

    const tempDir = await mkdtemp(join(tmpdir(), 'emitter-integration-'));
    const options: EmitOptions = {
      outputDir: tempDir,
      adapterPath: join(__dirname, '../../adapter-postgres'),
      writeFiles: true,
    };

    try {
      const result = await emit(ir, options);

      expect(result.coreHash).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(result.contractDts).toContain('export type Contract');
      expect(result.contractDts).toContain('CodecTypes');
      expect(result.contractDts).toContain('LaneCodecTypes');

      const contractJsonContent = await readFile(join(tempDir, 'contract.json'), 'utf-8');
      const contractJson = JSON.parse(contractJsonContent);

      expect(contractJson.schemaVersion).toBe('1');
      expect(contractJson.targetFamily).toBe('sql');
      expect(contractJson.target).toBe('postgres');
      expect(contractJson.coreHash).toBe(result.coreHash);
      expect(contractJson.storage.tables.user.columns.id.type).toBe('pg/int4@1');
      expect(contractJson.storage.tables.user.columns.email.type).toBe('pg/text@1');

      const contractDtsContent = await readFile(join(tempDir, 'contract.d.ts'), 'utf-8');
      expect(contractDtsContent).toContain('export type Contract');
      expect(contractDtsContent).toContain('SqlContract');
      expect(contractDtsContent).toContain('CodecTypes');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('produces stable hashes for identical input', async () => {
    const ir: ContractIR = {
      schemaVersion: '1',
      targetFamily: 'sql',
      target: 'postgres',
      models: {
        User: {
          storage: { table: 'user' },
          fields: {
            id: { column: 'id' },
          },
        },
      },
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'int4', nullable: false },
            },
            primaryKey: { columns: ['id'] },
          },
        },
      },
    };

    const tempDir1 = await mkdtemp(join(tmpdir(), 'emitter-stable-1-'));
    const tempDir2 = await mkdtemp(join(tmpdir(), 'emitter-stable-2-'));

    const options: EmitOptions = {
      outputDir: tempDir1,
      adapterPath: join(__dirname, '../../adapter-postgres'),
      writeFiles: true,
    };

    try {
      const result1 = await emit(ir, options);
      options.outputDir = tempDir2;
      const result2 = await emit(ir, options);

      expect(result1.coreHash).toBe(result2.coreHash);
      expect(result1.contractDts).toBe(result2.contractDts);
    } finally {
      await rm(tempDir1, { recursive: true, force: true });
      await rm(tempDir2, { recursive: true, force: true });
    }
  });
});

