import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { validateContract } from '@prisma-next/sql-contract/validate';
import { describe, expect, it } from 'vitest';
import { checkIncludeCapabilities, checkReturningCapability } from '../../src/utils/capabilities';

describe('capabilities', () => {
  describe('checkIncludeCapabilities', () => {
    it('throws when capabilities are missing', () => {
      const contract = validateContract<SqlContract<SqlStorage>>({
        target: 'postgres',
        targetFamily: 'sql',
        storageHash: 'test',
        storage: { tables: {} },
        models: {},
        relations: {},
        mappings: {},
      });

      expect(() => checkIncludeCapabilities(contract)).toThrow(
        'includeMany requires lateral and jsonAgg capabilities',
      );
    });

    it('throws when target capabilities are missing', () => {
      const contract = validateContract<SqlContract<SqlStorage>>({
        target: 'postgres',
        targetFamily: 'sql',
        storageHash: 'test',
        storage: { tables: {} },
        models: {},
        relations: {},
        mappings: {},
        capabilities: {},
      });

      expect(() => checkIncludeCapabilities(contract)).toThrow(
        'includeMany requires lateral and jsonAgg capabilities',
      );
    });

    it('throws when lateral is not true', () => {
      const contract = validateContract<SqlContract<SqlStorage>>({
        target: 'postgres',
        targetFamily: 'sql',
        storageHash: 'test',
        storage: { tables: {} },
        models: {},
        relations: {},
        mappings: {},
        capabilities: {
          postgres: {
            lateral: false,
            jsonAgg: true,
          },
        },
      });

      expect(() => checkIncludeCapabilities(contract)).toThrow(
        'includeMany requires lateral and jsonAgg capabilities to be true',
      );
    });

    it('throws when jsonAgg is not true', () => {
      const contract = validateContract<SqlContract<SqlStorage>>({
        target: 'postgres',
        targetFamily: 'sql',
        storageHash: 'test',
        storage: { tables: {} },
        models: {},
        relations: {},
        mappings: {},
        capabilities: {
          postgres: {
            lateral: true,
            jsonAgg: false,
          },
        },
      });

      expect(() => checkIncludeCapabilities(contract)).toThrow(
        'includeMany requires lateral and jsonAgg capabilities to be true',
      );
    });

    it('passes when both capabilities are true', () => {
      const contract = validateContract<SqlContract<SqlStorage>>({
        target: 'postgres',
        targetFamily: 'sql',
        storageHash: 'test',
        storage: { tables: {} },
        models: {},
        relations: {},
        mappings: {},
        capabilities: {
          postgres: {
            lateral: true,
            jsonAgg: true,
          },
        },
      });

      expect(() => checkIncludeCapabilities(contract)).not.toThrow();
    });
  });

  describe('checkReturningCapability', () => {
    it('throws when capabilities are missing', () => {
      const contract = validateContract<SqlContract<SqlStorage>>({
        target: 'postgres',
        targetFamily: 'sql',
        storageHash: 'test',
        storage: { tables: {} },
        models: {},
        relations: {},
        mappings: {},
      });

      expect(() => checkReturningCapability(contract)).toThrow(
        'returning() requires returning capability',
      );
    });

    it('throws when target capabilities are missing', () => {
      const contract = validateContract<SqlContract<SqlStorage>>({
        target: 'postgres',
        targetFamily: 'sql',
        storageHash: 'test',
        storage: { tables: {} },
        models: {},
        relations: {},
        mappings: {},
        capabilities: {},
      });

      expect(() => checkReturningCapability(contract)).toThrow(
        'returning() requires returning capability',
      );
    });

    it('throws when returning is not true', () => {
      const contract = validateContract<SqlContract<SqlStorage>>({
        target: 'postgres',
        targetFamily: 'sql',
        storageHash: 'test',
        storage: { tables: {} },
        models: {},
        relations: {},
        mappings: {},
        capabilities: {
          postgres: {
            returning: false,
          },
        },
      });

      expect(() => checkReturningCapability(contract)).toThrow(
        'returning() requires returning capability to be true',
      );
    });

    it('passes when returning is true', () => {
      const contract = validateContract<SqlContract<SqlStorage>>({
        target: 'postgres',
        targetFamily: 'sql',
        storageHash: 'test',
        storage: { tables: {} },
        models: {},
        relations: {},
        mappings: {},
        capabilities: {
          postgres: {
            returning: true,
          },
        },
      });

      expect(() => checkReturningCapability(contract)).not.toThrow();
    });
  });
});
