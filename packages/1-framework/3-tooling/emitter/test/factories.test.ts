import { contractIR, irHeader, irMeta } from '@prisma-next/contract/ir';
import { describe, expect, it } from 'vitest';

describe('emitter factories', () => {
  describe('irHeader', () => {
    it('creates header with required fields', () => {
      const header = irHeader({
        target: 'postgres',
        targetFamily: 'sql',
        coreHash: 'sha256:abc123',
      });
      expect(header).toEqual({
        schemaVersion: '1',
        target: 'postgres',
        targetFamily: 'sql',
        coreHash: 'sha256:abc123',
      });
    });

    it('creates header with profileHash', () => {
      const header = irHeader({
        target: 'postgres',
        targetFamily: 'sql',
        coreHash: 'sha256:abc123',
        profileHash: 'sha256:def456',
      });
      expect(header).toEqual({
        schemaVersion: '1',
        target: 'postgres',
        targetFamily: 'sql',
        coreHash: 'sha256:abc123',
        profileHash: 'sha256:def456',
      });
    });

    it('creates header for different target families', () => {
      const header = irHeader({
        target: 'mongodb',
        targetFamily: 'document',
        coreHash: 'sha256:xyz789',
      });
      expect(header.targetFamily).toBe('document');
      expect(header.target).toBe('mongodb');
    });
  });

  describe('irMeta', () => {
    it('creates empty meta when no options provided', () => {
      const meta = irMeta({});
      expect(meta).toEqual({
        capabilities: {},
        extensions: {},
        meta: {},
        sources: {},
      });
    });

    it('creates meta with capabilities', () => {
      const meta = irMeta({
        capabilities: {
          postgres: {
            returning: true,
            lateral: true,
          },
        },
      });
      expect(meta.capabilities).toEqual({
        postgres: {
          returning: true,
          lateral: true,
        },
      });
      expect(meta.extensions).toEqual({});
      expect(meta.meta).toEqual({});
      expect(meta.sources).toEqual({});
    });

    it('creates meta with extensions', () => {
      const meta = irMeta({
        extensions: {
          postgres: {
            id: 'postgres',
            version: '15.0.0',
          },
        },
      });
      expect(meta.extensions).toEqual({
        postgres: {
          id: 'postgres',
          version: '15.0.0',
        },
      });
    });

    it('creates meta with custom meta', () => {
      const meta = irMeta({
        meta: {
          generated: true,
          timestamp: '2024-01-01T00:00:00Z',
        },
      });
      expect(meta.meta).toEqual({
        generated: true,
        timestamp: '2024-01-01T00:00:00Z',
      });
    });

    it('creates meta with sources', () => {
      const meta = irMeta({
        sources: {
          userView: {
            kind: 'view',
            sql: 'SELECT * FROM "user"',
          },
        },
      });
      expect(meta.sources).toEqual({
        userView: {
          kind: 'view',
          sql: 'SELECT * FROM "user"',
        },
      });
    });

    it('creates meta with all fields', () => {
      const meta = irMeta({
        capabilities: {
          postgres: { returning: true },
        },
        extensions: {
          postgres: { id: 'postgres', version: '15.0.0' },
        },
        meta: { generated: true },
        sources: { userView: { kind: 'view' } },
      });
      expect(meta.capabilities).toEqual({
        postgres: { returning: true },
      });
      expect(meta.extensions).toEqual({
        postgres: { id: 'postgres', version: '15.0.0' },
      });
      expect(meta.meta).toEqual({ generated: true });
      expect(meta.sources).toEqual({ userView: { kind: 'view' } });
    });
  });

  describe('contractIR', () => {
    it('creates complete ContractIR from header, meta, and family sections', () => {
      const header = irHeader({
        target: 'postgres',
        targetFamily: 'sql',
        coreHash: 'sha256:abc123',
      });
      const meta = irMeta({
        capabilities: {
          postgres: { returning: true },
        },
      });
      const storage = { tables: { user: { columns: {} } } };
      const models = { User: { storage: { table: 'user' }, fields: {} } };
      const relations = {};

      const ir = contractIR({
        header,
        meta,
        storage,
        models,
        relations,
      });

      expect(ir.schemaVersion).toBe('1');
      expect(ir.target).toBe('postgres');
      expect(ir.targetFamily).toBe('sql');
      // Note: coreHash is not part of ContractIR (it's computed by emitter)
      expect(ir.storage).toEqual(storage);
      expect(ir.models).toEqual(models);
      expect(ir.relations).toEqual(relations);
      expect(ir.capabilities).toEqual({
        postgres: { returning: true },
      });
      expect(ir.extensions).toEqual({});
      expect(ir.meta).toEqual({});
      expect(ir.sources).toEqual({});
    });

    it('creates ContractIR with profileHash in header', () => {
      const header = irHeader({
        target: 'postgres',
        targetFamily: 'sql',
        coreHash: 'sha256:abc123',
        profileHash: 'sha256:def456',
      });
      const meta = irMeta({});
      const storage = { tables: {} };
      const models = {};
      const relations = {};

      const ir = contractIR({
        header,
        meta,
        storage,
        models,
        relations,
      });

      // Note: profileHash is not part of ContractIR (it's computed by emitter)
      // The header contains it, but it's not included in the ContractIR
      expect(header.profileHash).toBe('sha256:def456');
      expect(ir.target).toBe('postgres');
    });

    it('creates ContractIR with all meta fields', () => {
      const header = irHeader({
        target: 'postgres',
        targetFamily: 'sql',
        coreHash: 'sha256:abc123',
      });
      const meta = irMeta({
        capabilities: {
          postgres: { returning: true },
        },
        extensions: {
          postgres: { id: 'postgres', version: '15.0.0' },
        },
        meta: { generated: true },
        sources: { userView: { kind: 'view' } },
      });
      const storage = { tables: {} };
      const models = {};
      const relations = {};

      const ir = contractIR({
        header,
        meta,
        storage,
        models,
        relations,
      });

      expect(ir.capabilities).toEqual({
        postgres: { returning: true },
      });
      expect(ir.extensions).toEqual({
        postgres: { id: 'postgres', version: '15.0.0' },
      });
      expect(ir.meta).toEqual({ generated: true });
      expect(ir.sources).toEqual({ userView: { kind: 'view' } });
    });

    it('creates ContractIR for document family', () => {
      const header = irHeader({
        target: 'mongodb',
        targetFamily: 'document',
        coreHash: 'sha256:xyz789',
      });
      const meta = irMeta({});
      const storage = { document: { collections: {} } };
      const models = {};
      const relations = {};

      const ir = contractIR({
        header,
        meta,
        storage,
        models,
        relations,
      });

      expect(ir.targetFamily).toBe('document');
      expect(ir.target).toBe('mongodb');
      expect(ir.storage).toEqual(storage);
    });
  });
});
