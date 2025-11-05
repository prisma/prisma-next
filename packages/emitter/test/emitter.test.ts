import { describe, it, expect, beforeEach } from 'vitest';
import { emit } from '../src/emitter';
import { targetFamilyRegistry } from '../src/target-family-registry';
import { sqlTargetFamilyHook } from '@prisma-next/sql-target';
import type { ContractIR, EmitOptions } from '../src/types';
import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

describe('emitter', () => {
  beforeEach(() => {
    if (!targetFamilyRegistry.has('sql')) {
      targetFamilyRegistry.register(sqlTargetFamilyHook);
    }
  });

  it('emits contract.json and contract.d.ts', async () => {
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

    const tempDir = await mkdtemp(join(tmpdir(), 'emitter-test-'));
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
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('canonicalizes bare scalars to typeIds', async () => {
    const ir: ContractIR = {
      schemaVersion: '1',
      targetFamily: 'sql',
      target: 'postgres',
      models: {},
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

    const tempDir = await mkdtemp(join(tmpdir(), 'emitter-test-'));
    const options: EmitOptions = {
      outputDir: tempDir,
      adapterPath: join(__dirname, '../../adapter-postgres'),
      writeFiles: true,
    };

    try {
      const result = await emit(ir, options);
      const storage = result.contractJson.storage as { tables: { user: { columns: { id: { type: string } } } } };
      expect(storage.tables.user.columns.id.type).toBe('pg/int4@1');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

