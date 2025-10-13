import { describe, it, expect, vi } from 'vitest';
import { sql } from '../src/sql';
import { makeT } from '../src/maket';
import { Schema } from '@prisma/relational-ir';

describe('Contract Hash Verification', () => {
  const mockIr1: Schema = {
    target: 'postgres',
    contractHash: 'sha256:abc123',
    tables: {
      user: {
        columns: {
          id: { type: 'int4', nullable: false, pk: true },
          email: { type: 'text', nullable: false, unique: true },
          active: { type: 'bool', nullable: false, default: { kind: 'literal', value: 'true' } },
        },
        indexes: [],
        constraints: [],
        capabilities: [],
      },
    },
  };

  const mockIr2: Schema = {
    target: 'postgres',
    contractHash: 'sha256:def456',
    tables: {
      user: {
        columns: {
          id: { type: 'int4', nullable: false, pk: true },
          email: { type: 'text', nullable: false, unique: true },
        },
        indexes: [],
        constraints: [],
        capabilities: [],
      },
    },
  };

  describe('makeT()', () => {
    it('adds contract hash to tables and columns', () => {
      const t = makeT(mockIr1);

      expect(t.user.__contractHash).toBe('sha256:abc123');
      expect(t.user.id.__contractHash).toBe('sha256:abc123');
      expect(t.user.email.__contractHash).toBe('sha256:abc123');
      expect(t.user.active.__contractHash).toBe('sha256:abc123');
    });

    it('handles undefined contract hash', () => {
      const irWithoutHash = { ...mockIr1, contractHash: undefined };
      const t = makeT(irWithoutHash);

      expect(t.user.__contractHash).toBeUndefined();
      expect(t.user.id.__contractHash).toBeUndefined();
    });
  });

  describe('sql.from()', () => {
    it('detects hash mismatch in table reference', () => {
      const t1 = makeT(mockIr1);
      const t2 = makeT(mockIr2);

      expect(() => {
        sql(mockIr1).from(t2.user);
      }).toThrow('E_CONTRACT_MISMATCH: contract hash mismatch in from()');
    });

    it('allows matching hash', () => {
      const t = makeT(mockIr1);

      expect(() => {
        sql(mockIr1).from(t.user);
      }).not.toThrow();
    });

    it('handles warn mode', () => {
      const t1 = makeT(mockIr1);
      const t2 = makeT(mockIr2);

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      expect(() => {
        sql(mockIr1, { onContractMismatch: 'warn' }).from(t2.user);
      }).not.toThrow();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('E_CONTRACT_MISMATCH: contract hash mismatch in from()'),
      );

      consoleSpy.mockRestore();
    });

    it('handles string table names', () => {
      expect(() => {
        sql(mockIr1).from('user');
      }).not.toThrow();
    });
  });

  describe('QueryBuilder.build()', () => {
    it('detects hash mismatch in select columns', () => {
      const t1 = makeT(mockIr1);
      const t2 = makeT(mockIr2);

      expect(() => {
        sql(mockIr1).from(t1.user).select({
          id: t1.user.id, // ✓ Same hash
          email: t2.user.email, // ✗ Different hash
        });
      }).toThrow('E_CONTRACT_MISMATCH: contract hash mismatch in select()');
    });

    it('allows matching hash in all columns', () => {
      const t = makeT(mockIr1);

      const query = sql(mockIr1).from(t.user).select({
        id: t.user.id,
        email: t.user.email,
        active: t.user.active,
      });

      expect(() => {
        query.build();
      }).not.toThrow();
    });

    it('handles warn mode in build()', () => {
      const t1 = makeT(mockIr1);
      const t2 = makeT(mockIr2);

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const query = sql(mockIr1, { onContractMismatch: 'warn' }).from(t1.user).select({
        id: t1.user.id,
        email: t2.user.email, // Different hash
      });

      expect(() => {
        query.build();
      }).not.toThrow();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('E_CONTRACT_MISMATCH: contract hash mismatch in build()'),
      );

      consoleSpy.mockRestore();
    });
  });

  describe('QueryAST contract hash', () => {
    it('embeds contract hash in AST', () => {
      const t = makeT(mockIr1);

      const query = sql(mockIr1).from(t.user).select({ id: t.user.id });

      const result = query.build();

      // The AST should carry the contract hash
      // Note: This is internal implementation detail, but useful for testing
      expect((query as any).ast.contractHash).toBe('sha256:abc123');
    });
  });

  describe('Mixed IR scenarios', () => {
    it('prevents mixing columns from different IR versions', () => {
      const t1 = makeT(mockIr1);
      const t2 = makeT(mockIr2);

      // This should fail at from() level
      expect(() => {
        sql(mockIr1).from(t2.user);
      }).toThrow();

      // This should fail at select() level
      expect(() => {
        sql(mockIr1).from(t1.user).select({
          id: t1.user.id,
          email: t2.user.email,
        });
      }).toThrow('E_CONTRACT_MISMATCH: contract hash mismatch in select()');
    });
  });

  describe('Error messages', () => {
    it('provides actionable error messages', () => {
      const t1 = makeT(mockIr1);
      const t2 = makeT(mockIr2);

      try {
        sql(mockIr1).from(t2.user);
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error.message).toContain('E_CONTRACT_MISMATCH');
        expect(error.message).toContain('from()');
        expect(error.message).toContain('sha256:abc123');
        expect(error.message).toContain('sha256:def456');
        expect(error.message).toContain('Hint: ensure all DSL elements come from the same IR');
      }
    });
  });
});
