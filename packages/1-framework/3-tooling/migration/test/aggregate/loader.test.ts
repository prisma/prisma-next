import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createSqlContract } from '@prisma-next/contract/testing';
import type { Contract } from '@prisma-next/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadContractSpaceAggregate } from '../../src/aggregate/loader';
import type { ContractSpaceAggregate } from '../../src/aggregate/types';
import type { IntegrityViolation } from '../../src/integrity-violation';
import { writeTestPackage } from '../fixtures';

/**
 * Build a SQL/postgres contract that claims the given storage element
 * names as tables. The storage hash is computed by `createSqlContract`.
 */
function sqlContractWithTables(args: { target?: string; tables: readonly string[] }): Contract {
  const tables = Object.fromEntries(args.tables.map((name) => [name, { columns: { id: {} } }]));
  return createSqlContract({
    target: args.target ?? 'postgres',
    storage: {
      namespaces: { [UNBOUND_NAMESPACE_ID]: { id: UNBOUND_NAMESPACE_ID, tables } },
    },
  });
}

const APP_CONTRACT = sqlContractWithTables({ tables: ['user'] });

// Identity deserializer: the loader reads the raw on-disk contract.json
// and hands the parsed value here; tests stand it up as a typed contract
// without separate validation. The cast is test-only (production wires a
// family-aware validator). `as` is permitted in test files.
const identityDeserialize = (json: unknown): Contract => json as Contract;

describe('loadContractSpaceAggregate', () => {
  let migrationsDir: string;

  beforeEach(async () => {
    migrationsDir = await mkdtemp(join(tmpdir(), 'load-aggregate-'));
  });

  afterEach(async () => {
    await rm(migrationsDir, { recursive: true, force: true });
  });

  function load(appContract: Contract = APP_CONTRACT): Promise<ContractSpaceAggregate> {
    return loadContractSpaceAggregate({
      migrationsDir,
      deserializeContract: identityDeserialize,
      appContract,
    });
  }

  /** Write a migration package under `migrations/<spaceId>/<dirName>`. */
  function writePackage(
    spaceId: string,
    dirName: string,
    meta: Parameters<typeof writeTestPackage>[1] = {},
    ops?: Parameters<typeof writeTestPackage>[2],
  ): Promise<unknown> {
    return writeTestPackage(join(migrationsDir, spaceId, dirName), meta, ops);
  }

  /** Write `migrations/<spaceId>/refs/head.json`. */
  async function writeHeadRef(
    spaceId: string,
    headRef: { hash: string; invariants: readonly string[] },
  ): Promise<void> {
    const refsDir = join(migrationsDir, spaceId, 'refs');
    await mkdir(refsDir, { recursive: true });
    await writeFile(join(refsDir, 'head.json'), JSON.stringify(headRef, null, 2));
  }

  /** Write `migrations/<spaceId>/contract.json` verbatim. */
  async function writeContractJson(spaceId: string, contract: unknown): Promise<void> {
    await mkdir(join(migrationsDir, spaceId), { recursive: true });
    await writeFile(join(migrationsDir, spaceId, 'contract.json'), JSON.stringify(contract));
  }

  function violationsOfKind<K extends IntegrityViolation['kind']>(
    violations: readonly IntegrityViolation[],
    kind: K,
  ): readonly Extract<IntegrityViolation, { kind: K }>[] {
    return violations.filter((v): v is Extract<IntegrityViolation, { kind: K }> => v.kind === kind);
  }

  describe('tolerant construction', () => {
    it('resolves with an empty extension set when migrations/ is absent', async () => {
      const aggregate = await load();
      expect(aggregate.app.spaceId).toBe('app');
      expect(aggregate.extensions).toEqual([]);
    });

    it('never throws on a hash-mismatched, unparseable, or self-edge package', async () => {
      // app: a self-edge package (from === to, no data op).
      await writePackage('app', '20260101T0000_self', {
        from: 'sha256:app-head',
        to: 'sha256:app-head',
      });
      // alpha: a hash-mismatched package (retained) and no head ref.
      await writePackage('alpha', '20260101T0000_init', { from: null, to: 'sha256:a1' });
      await writeFile(join(migrationsDir, 'alpha', '20260101T0000_init', 'ops.json'), '[]');
      // beta: an unparseable package (omitted) and a head ref.
      await mkdir(join(migrationsDir, 'beta', '20260101T0000_broken'), { recursive: true });
      await writeFile(
        join(migrationsDir, 'beta', '20260101T0000_broken', 'migration.json'),
        'not json',
      );
      await writeFile(join(migrationsDir, 'beta', '20260101T0000_broken', 'ops.json'), '[]');
      await writeHeadRef('beta', { hash: 'sha256:b1', invariants: [] });

      const aggregate = await load();
      expect(aggregate.listSpaces()).toEqual(['app', 'alpha', 'beta']);
      // Recoverable packages are retained; the unparseable one is omitted.
      expect(aggregate.space('alpha')?.packages).toHaveLength(1);
      expect(aggregate.space('beta')?.packages).toHaveLength(0);
    });
  });

  describe('app member', () => {
    it('synthesises the app head ref from the live contract storage hash', async () => {
      const aggregate = await load();
      expect(aggregate.app.headRef).toEqual({
        hash: APP_CONTRACT.storage.storageHash,
        invariants: [],
      });
    });

    it('app.contract() returns the supplied live contract by reference', async () => {
      const aggregate = await load();
      expect(aggregate.app.contract()).toBe(APP_CONTRACT);
    });

    it('reads app migration packages from disk', async () => {
      await writePackage('app', '20260101T0000_init', { from: null, to: 'sha256:app-head' });
      const aggregate = await load();
      expect(aggregate.app.packages).toHaveLength(1);
      expect(aggregate.app.packages[0]?.dirName).toBe('20260101T0000_init');
    });
  });

  describe('lazy memoised facets', () => {
    it('graph() returns the same instance across calls', async () => {
      const aggregate = await load();
      expect(aggregate.app.graph()).toBe(aggregate.app.graph());
    });

    it('extension contract() deserializes the on-disk contract.json and memoises it', async () => {
      const extContract = sqlContractWithTables({ tables: ['ext_table'] });
      await writePackage('cipherstash', '20260101T0000_init', { from: null, to: 'sha256:c1' });
      await writeHeadRef('cipherstash', { hash: 'sha256:c1', invariants: [] });
      await writeContractJson('cipherstash', extContract);

      const aggregate = await load();
      const member = aggregate.space('cipherstash');
      const first = member?.contract();
      expect(first).toBe(member?.contract());
      expect(first?.target).toBe('postgres');
    });
  });

  describe('query methods', () => {
    it('lists app first, then extension ids lex-ascending', async () => {
      await writePackage('zeta', '20260101T0000_init', { from: null, to: 'sha256:z1' });
      await writePackage('alpha', '20260101T0000_init', { from: null, to: 'sha256:a1' });
      const aggregate = await load();
      expect(aggregate.listSpaces()).toEqual(['app', 'alpha', 'zeta']);
      expect(aggregate.spaces().map((m) => m.spaceId)).toEqual(['app', 'alpha', 'zeta']);
    });

    it('hasSpace / space resolve by id', async () => {
      await writePackage('alpha', '20260101T0000_init', { from: null, to: 'sha256:a1' });
      const aggregate = await load();
      expect(aggregate.hasSpace('app')).toBe(true);
      expect(aggregate.hasSpace('alpha')).toBe(true);
      expect(aggregate.hasSpace('missing')).toBe(false);
      expect(aggregate.space('alpha')?.spaceId).toBe('alpha');
      expect(aggregate.space('missing')).toBeUndefined();
    });
  });

  describe('checkIntegrity', () => {
    it('returns the full structural violation set without bailing at the first', async () => {
      await writePackage('app', '20260101T0000_self', {
        from: 'sha256:app-head',
        to: 'sha256:app-head',
      });
      await writePackage('alpha', '20260101T0000_init', { from: null, to: 'sha256:a1' });
      await writeFile(join(migrationsDir, 'alpha', '20260101T0000_init', 'ops.json'), '[]');
      await mkdir(join(migrationsDir, 'beta', '20260101T0000_broken'), { recursive: true });
      await writeFile(
        join(migrationsDir, 'beta', '20260101T0000_broken', 'migration.json'),
        'not json',
      );
      await writeFile(join(migrationsDir, 'beta', '20260101T0000_broken', 'ops.json'), '[]');
      await writeHeadRef('beta', { hash: 'sha256:b1', invariants: [] });

      const violations = (await load()).checkIntegrity();

      expect(violationsOfKind(violations, 'sameSourceAndTarget').map((v) => v.spaceId)).toContain(
        'app',
      );
      expect(violationsOfKind(violations, 'hashMismatch').map((v) => v.spaceId)).toContain('alpha');
      expect(violationsOfKind(violations, 'headRefMissing').map((v) => v.spaceId)).toContain(
        'alpha',
      );
      expect(violationsOfKind(violations, 'packageUnloadable').map((v) => v.spaceId)).toContain(
        'beta',
      );
      expect(violationsOfKind(violations, 'headRefNotInGraph').map((v) => v.spaceId)).toContain(
        'beta',
      );
      // No bail: violations span more than one space.
      expect(
        new Set(violations.map((v) => ('spaceId' in v ? v.spaceId : '*'))).size,
      ).toBeGreaterThan(1);
    });

    it('omits config/contract checks unless the matching opt is set', async () => {
      await writePackage('orphan', '20260101T0000_init', { from: null, to: 'sha256:o1' });
      await writeHeadRef('orphan', { hash: 'sha256:o1', invariants: [] });
      const aggregate = await load();

      const bare = aggregate.checkIntegrity();
      expect(violationsOfKind(bare, 'orphanSpaceDir')).toHaveLength(0);
      expect(violationsOfKind(bare, 'targetMismatch')).toHaveLength(0);
    });

    it('gates layout-drift checks behind declaredExtensions', async () => {
      await writePackage('present', '20260101T0000_init', { from: null, to: 'sha256:p1' });
      await writeHeadRef('present', { hash: 'sha256:p1', invariants: [] });
      const aggregate = await load();

      const violations = aggregate.checkIntegrity({
        declaredExtensions: [{ id: 'declared-but-absent', targetId: 'postgres' }],
      });
      // `present` exists on disk but is not declared → orphanSpaceDir.
      expect(violationsOfKind(violations, 'orphanSpaceDir').map((v) => v.spaceId)).toEqual([
        'present',
      ]);
      // `declared-but-absent` is declared but has no on-disk dir.
      expect(violationsOfKind(violations, 'declaredButUnmigrated').map((v) => v.spaceId)).toEqual([
        'declared-but-absent',
      ]);
    });

    it('gates target / disjointness / contract checks behind requireContracts', async () => {
      // wrongtarget: a deserializable contract whose target differs.
      await writePackage('wrongtarget', '20260101T0000_init', { from: null, to: 'sha256:w1' });
      await writeHeadRef('wrongtarget', { hash: 'sha256:w1', invariants: [] });
      await writeContractJson(
        'wrongtarget',
        sqlContractWithTables({ target: 'sqlite', tables: ['wt'] }),
      );
      // sharer: claims the same `user` table as the app → disjointness.
      await writePackage('sharer', '20260101T0000_init', { from: null, to: 'sha256:s1' });
      await writeHeadRef('sharer', { hash: 'sha256:s1', invariants: [] });
      await writeContractJson('sharer', sqlContractWithTables({ tables: ['user'] }));
      // broken: no contract.json → contract() throws → contractUnreadable.
      await writePackage('broken', '20260101T0000_init', { from: null, to: 'sha256:k1' });
      await writeHeadRef('broken', { hash: 'sha256:k1', invariants: [] });

      const aggregate = await load();

      const bare = aggregate.checkIntegrity();
      expect(violationsOfKind(bare, 'targetMismatch')).toHaveLength(0);
      expect(violationsOfKind(bare, 'disjointness')).toHaveLength(0);
      expect(violationsOfKind(bare, 'contractUnreadable')).toHaveLength(0);

      const gated = aggregate.checkIntegrity({ requireContracts: true });
      expect(violationsOfKind(gated, 'targetMismatch').map((v) => v.spaceId)).toContain(
        'wrongtarget',
      );
      expect(violationsOfKind(gated, 'disjointness').map((v) => v.element)).toContain('user');
      expect(violationsOfKind(gated, 'contractUnreadable').map((v) => v.spaceId)).toContain(
        'broken',
      );
    });
  });
});
