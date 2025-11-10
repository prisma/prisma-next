import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract-types';
import { createCodecRegistry } from '@prisma-next/sql-target';
import { describe, expect, it } from 'vitest';
import { codecDefinitions } from '../../adapter-postgres/src/codecs';
import { extractTypeIds, validateCodecRegistryCompleteness } from '../src/codecs/validation';
import { createTestContract } from './utils';

function createRegistry() {
  const registry = createCodecRegistry();
  for (const definition of Object.values(codecDefinitions)) {
    registry.register(definition.codec);
  }
  return registry;
}

describe('Codec Registry Validation', () => {
  it('extracts type IDs from contract', () => {
    const contractRaw: SqlContract<SqlStorage> = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      coreHash: 'sha256:test',
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
              email: { type: 'pg/text@1', nullable: false },
              createdAt: { type: 'pg/timestamptz@1', nullable: true },
            },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
          post: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
              title: { type: 'pg/text@1', nullable: false },
            },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
      models: {},
      relations: {},
      mappings: {
        codecTypes: {},
        operationTypes: {},
      },
    };

    const contract = createTestContract(contractRaw);
    const typeIds = extractTypeIds(contract);
    expect(typeIds.size).toBe(3);
    expect(typeIds.has('pg/int4@1')).toBe(true);
    expect(typeIds.has('pg/text@1')).toBe(true);
    expect(typeIds.has('pg/timestamptz@1')).toBe(true);
  });

  it('handles contract with no tables', () => {
    const contract: SqlContract<SqlStorage> = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      coreHash: 'sha256:test',
      storage: {
        tables: {},
      },
      models: {},
      relations: {},
      mappings: {
        codecTypes: {},
        operationTypes: {},
      },
    };

    const typeIds = extractTypeIds(contract);
    expect(typeIds.size).toBe(0);
  });

  it('handles columns without type', () => {
    const contractRaw: SqlContract<SqlStorage> = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      coreHash: 'sha256:test',
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
              email: { type: 'pg/text@1', nullable: false },
            },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
      models: {},
      relations: {},
      mappings: {
        codecTypes: {},
        operationTypes: {},
      },
    };

    const contract = createTestContract(contractRaw);
    const typeIds = extractTypeIds(contract);
    expect(typeIds.size).toBe(2);
    expect(typeIds.has('pg/int4@1')).toBe(true);
    expect(typeIds.has('pg/text@1')).toBe(true);
  });

  it('validates complete registry passes', () => {
    const contractRaw: SqlContract<SqlStorage> = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      coreHash: 'sha256:test',
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
              email: { type: 'pg/text@1', nullable: false },
              createdAt: { type: 'pg/timestamptz@1', nullable: false },
            },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
      models: {},
      relations: {},
      mappings: {
        codecTypes: {},
        operationTypes: {},
      },
    };
    const contract = createTestContract(contractRaw);

    const registry = createRegistry();
    expect(() => validateCodecRegistryCompleteness(registry, contract)).not.toThrow();
  });

  it('throws RUNTIME.CODEC_MISSING for missing codecs', () => {
    // Create contract with unknown type ID directly (bypassing validation)
    const contract: SqlContract<SqlStorage> = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      coreHash: 'sha256:test',
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
              email: { type: 'pg/text@1', nullable: false },
              unknownType: { type: 'unknown/type@1', nullable: false },
            },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
      models: {},
      relations: {},
      mappings: {
        codecTypes: {},
        operationTypes: {},
      },
    };

    const registry = createRegistry();
    expect(() => validateCodecRegistryCompleteness(registry, contract)).toThrow();
    try {
      validateCodecRegistryCompleteness(registry, contract);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      const runtimeError = error as Error & { code: string; details?: Record<string, unknown> };
      expect(runtimeError.code).toBe('RUNTIME.CODEC_MISSING');
      expect(runtimeError.details).toBeDefined();
      const invalidCodecs = runtimeError.details?.['invalidCodecs'] as
        | Array<{ table: string; column: string; typeId: string }>
        | undefined;
      expect(invalidCodecs).toBeDefined();
      expect(invalidCodecs?.some((c) => c.typeId === 'unknown/type@1')).toBe(true);
      expect(runtimeError.details?.['contractTarget']).toBe('postgres');
    }
  });

  it('validates empty registry against empty contract', () => {
    const contract: SqlContract<SqlStorage> = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      coreHash: 'sha256:test',
      storage: {
        tables: {},
      },
      models: {},
      relations: {},
      mappings: {
        codecTypes: {},
        operationTypes: {},
      },
    };

    const emptyRegistry = createCodecRegistry();

    expect(() => validateCodecRegistryCompleteness(emptyRegistry, contract)).not.toThrow();
  });
});
