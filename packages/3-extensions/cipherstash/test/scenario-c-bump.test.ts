/**
 * T3.7 / Scenario C — bump-cipherstash diff test (pure-fixture, no DB).
 *
 * The cipherstash-migration sub-spec § 7 codifies a property of the
 * framework's `migrate`-time on-disk shape:
 *
 *   when an extension version bump produces a new contract hash + a
 *   new migration package, re-running the materialisation passes
 *   should
 *     (a) refresh the pinned `contract.json` / `contract.d.ts` /
 *         `refs/head.json` so the head pointer advances,
 *     (b) write the new migration directory under
 *         `migrations/<spaceId>/<newDirName>/`, and
 *     (c) leave the previously-emitted migration directory(s)
 *         byte-untouched (AC-7 / AM12 by-existence skip).
 *
 * Pure fixture means: no live Postgres, no PGlite — the test computes
 * the on-disk shape and asserts on it. The two passes invoked here
 * (`emitPinnedSpaceArtefacts` + `materialiseExtensionMigrationPackageIfMissing`)
 * are the *exact* primitives the CLI's `runContractSpaceMigratePass`
 * + `runContractSpaceExtensionMigrationsPass` call. Calling them
 * directly keeps cipherstash's test cone independent of the CLI
 * package (cipherstash must not import the CLI).
 *
 * Locks AC-14 (cipherstash-migration spec) → project AC9 (extension
 * version bump → diff-able migrations + advancing head ref). Sub-spec
 * § 7 is the source of truth for the assertion list.
 */

import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeStorageHash } from '@prisma-next/contract/hashing';
import { type Contract, coreHash, profileHash } from '@prisma-next/contract/types';
import type {
  ExtensionContractRef,
  SqlMigrationPlanOperation,
} from '@prisma-next/family-sql/control';
import { computeMigrationHash } from '@prisma-next/migration-tools/hash';
import {
  materialiseExtensionMigrationPackageIfMissing,
  writeExtensionMigrationPackage,
} from '@prisma-next/migration-tools/io';
import type { MigrationPackage } from '@prisma-next/migration-tools/package';
import {
  emitPinnedSpaceArtefacts,
  spaceMigrationDirectory,
} from '@prisma-next/migration-tools/spaces';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CIPHERSTASH_SPACE_ID,
  EQL_V2_CONFIGURATION_STATE_TYPE,
  EQL_V2_CONFIGURATION_TABLE,
} from '../src/core/constants';

interface SyntheticVersion {
  readonly contract: Contract<SqlStorage>;
  readonly contractDts: string;
  readonly headRef: ExtensionContractRef;
  readonly migrations: readonly MigrationPackage[];
}

const PROFILE = profileHash('cipherstash-extension-profile-v1');

/**
 * Build a tiny cipherstash-shaped descriptor at version `v`. The
 * configuration table grows a new column at v2 (the audit_column from
 * sub-spec § 6 Scenario C); that's what advances the storage hash and
 * justifies the new migration package.
 */
function buildVersion(v: 1 | 2): SyntheticVersion {
  const baseColumns = {
    id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
    state: {
      codecId: 'pg/text@1',
      nativeType: EQL_V2_CONFIGURATION_STATE_TYPE,
      nullable: false,
    },
    data: { codecId: 'pg/jsonb@1', nativeType: 'jsonb', nullable: false },
  };
  const v2OnlyColumns = {
    audit_column: { codecId: 'pg/text@1', nativeType: 'text', nullable: true },
  };

  const storageBody = {
    tables: {
      [EQL_V2_CONFIGURATION_TABLE]: {
        columns: v === 1 ? baseColumns : { ...baseColumns, ...v2OnlyColumns },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    },
  };

  const storageHash = computeStorageHash({
    target: 'postgres',
    targetFamily: 'sql',
    storage: storageBody,
  });

  const contract: Contract<SqlStorage> = {
    target: 'postgres',
    targetFamily: 'sql',
    roots: {},
    models: {},
    capabilities: {},
    extensionPacks: {},
    meta: {},
    profileHash: PROFILE,
    storage: { ...storageBody, storageHash: coreHash(storageHash) },
  };

  const baselineOps: readonly SqlMigrationPlanOperation<unknown>[] = [
    {
      id: 'cipherstash.install-eql-bundle',
      label: 'install eql bundle',
      operationClass: 'additive',
      invariantId: 'cipherstash:install-eql-bundle-v1',
      target: {
        id: 'postgres',
        details: { schema: 'eql_v2', objectType: 'extension', name: 'eql_v2' },
      },
      precheck: [],
      execute: [{ description: 'noop', sql: 'SELECT 1' }],
      postcheck: [],
    },
  ];
  const baselineProvided = ['cipherstash:install-eql-bundle-v1'];
  const baselineMetaNoHash = {
    from: null,
    to: storageHash,
    fromContract: null,
    toContract: contract,
    hints: { used: [], applied: [], plannerVersion: '2.0.0' },
    labels: [],
    providedInvariants: baselineProvided,
    createdAt: '2026-06-01T00:00:00.000Z',
  } as const;
  const baseline: MigrationPackage = {
    dirName: '20260601T0000_install_eql_bundle',
    dirPath: '20260601T0000_install_eql_bundle',
    metadata: {
      ...baselineMetaNoHash,
      migrationHash: computeMigrationHash(baselineMetaNoHash, baselineOps),
    },
    ops: baselineOps,
  };

  if (v === 1) {
    return {
      contract,
      contractDts: '// v1 placeholder\nexport {};\n',
      headRef: { hash: storageHash, invariants: baselineProvided },
      migrations: [baseline],
    };
  }

  // v2: re-derive baseline against v1's contract (so its `to` still
  // points at v1's storage hash), then append the audit-column bump.
  const v1 = buildVersion(1);
  const v1Hash = v1.headRef.hash;
  const auditOps: readonly SqlMigrationPlanOperation<unknown>[] = [
    {
      id: 'cipherstash.add-audit-column',
      label: 'add audit_column to eql_v2_configuration',
      operationClass: 'additive',
      invariantId: 'cipherstash:add-audit-column-v1',
      target: {
        id: 'postgres',
        details: { schema: 'public', objectType: 'table', name: EQL_V2_CONFIGURATION_TABLE },
      },
      precheck: [],
      execute: [
        {
          description: 'add audit_column',
          sql: `ALTER TABLE public."${EQL_V2_CONFIGURATION_TABLE}" ADD COLUMN audit_column text;`,
        },
      ],
      postcheck: [],
    },
  ];
  const auditProvided = ['cipherstash:add-audit-column-v1'];
  const auditMetaNoHash = {
    from: v1Hash,
    to: storageHash,
    fromContract: v1.contract,
    toContract: contract,
    hints: { used: [], applied: [], plannerVersion: '2.0.0' },
    labels: [],
    providedInvariants: auditProvided,
    createdAt: '2026-06-15T00:00:00.000Z',
  } as const;
  const auditPkg: MigrationPackage = {
    dirName: '20260615T0000_add_audit_column',
    dirPath: '20260615T0000_add_audit_column',
    metadata: {
      ...auditMetaNoHash,
      migrationHash: computeMigrationHash(auditMetaNoHash, auditOps),
    },
    ops: auditOps,
  };

  return {
    contract,
    contractDts: '// v2 placeholder\nexport {};\n',
    headRef: {
      hash: storageHash,
      invariants: [...baselineProvided, ...auditProvided].sort(),
    },
    migrations: [v1.migrations[0]!, auditPkg],
  };
}

interface BumpFixture {
  readonly projectRoot: string;
  readonly migrationsDir: string;
  readonly cipherstashSpaceDir: string;
}

async function setupBumpFixture(): Promise<BumpFixture> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'cipherstash-bump-'));
  const migrationsDir = join(projectRoot, 'migrations');
  const cipherstashSpaceDir = spaceMigrationDirectory(migrationsDir, CIPHERSTASH_SPACE_ID);
  return { projectRoot, migrationsDir, cipherstashSpaceDir };
}

async function pinDescriptorVersion(
  fixture: BumpFixture,
  version: SyntheticVersion,
  options: { readonly write: 'pinnedOnly' | 'pinnedAndMigrations' },
): Promise<void> {
  await emitPinnedSpaceArtefacts(fixture.migrationsDir, CIPHERSTASH_SPACE_ID, {
    contract: version.contract,
    contractDts: version.contractDts,
    headRef: { hash: version.headRef.hash, invariants: [...version.headRef.invariants] },
  });
  if (options.write === 'pinnedAndMigrations') {
    for (const pkg of version.migrations) {
      await writeExtensionMigrationPackage(fixture.cipherstashSpaceDir, pkg);
    }
  }
}

async function rematerialiseAll(
  fixture: BumpFixture,
  version: SyntheticVersion,
): Promise<{ readonly written: string[]; readonly skipped: string[] }> {
  const written: string[] = [];
  const skipped: string[] = [];
  for (const pkg of version.migrations) {
    const result = await materialiseExtensionMigrationPackageIfMissing(
      fixture.cipherstashSpaceDir,
      pkg,
    );
    (result.written ? written : skipped).push(pkg.dirName);
  }
  return { written, skipped };
}

describe('cipherstash AC-14 — bump diff (Scenario C, pure-fixture)', () => {
  let fixture: BumpFixture;
  let v1: SyntheticVersion;
  let v2: SyntheticVersion;

  beforeEach(async () => {
    fixture = await setupBumpFixture();
    v1 = buildVersion(1);
    v2 = buildVersion(2);
  });

  afterEach(async () => {
    await rm(fixture.projectRoot, { recursive: true, force: true });
  });

  it('starts with v1 storage hash distinct from v2 storage hash (sanity)', () => {
    expect(v1.headRef.hash).not.toBe(v2.headRef.hash);
    expect(v2.headRef.invariants.length).toBe(v1.headRef.invariants.length + 1);
  });

  describe('after a v1 → v2 bump', () => {
    let v1HeadRefRaw: string;
    let v1ContractRaw: string;
    let v1BaselineDir: string;
    let v1BaselineFiles: {
      readonly migration: Buffer;
      readonly ops: Buffer;
      readonly contract: Buffer;
    };
    let bumpResult: { readonly written: string[]; readonly skipped: string[] };

    beforeEach(async () => {
      // 1. Pin v1 + materialise its (single) migration.
      await pinDescriptorVersion(fixture, v1, { write: 'pinnedAndMigrations' });

      v1HeadRefRaw = await readFile(
        join(fixture.cipherstashSpaceDir, 'refs', 'head.json'),
        'utf-8',
      );
      v1ContractRaw = await readFile(join(fixture.cipherstashSpaceDir, 'contract.json'), 'utf-8');
      v1BaselineDir = join(fixture.cipherstashSpaceDir, v1.migrations[0]!.dirName);
      v1BaselineFiles = {
        migration: await readFile(join(v1BaselineDir, 'migration.json')),
        ops: await readFile(join(v1BaselineDir, 'ops.json')),
        contract: await readFile(join(v1BaselineDir, 'contract.json')),
      };

      // 2. Run both passes against v2 (the bump).
      await pinDescriptorVersion(fixture, v2, { write: 'pinnedOnly' });
      bumpResult = await rematerialiseAll(fixture, v2);
    });

    it('refs/head.json updates to the v2 hash + invariant set', async () => {
      const after = await readFile(join(fixture.cipherstashSpaceDir, 'refs', 'head.json'), 'utf-8');
      expect(after).not.toBe(v1HeadRefRaw);
      const parsed = JSON.parse(after) as { readonly hash: string; readonly invariants: string[] };
      expect(parsed.hash).toBe(v2.headRef.hash);
      expect(parsed.invariants).toEqual([...v2.headRef.invariants].sort());
    });

    it('pinned contract.json reflects the v2 contract storage', async () => {
      const after = await readFile(join(fixture.cipherstashSpaceDir, 'contract.json'), 'utf-8');
      expect(after).not.toBe(v1ContractRaw);
      const parsed = JSON.parse(after) as {
        readonly storage: {
          readonly storageHash: string;
          readonly tables: Record<string, { readonly columns: Record<string, unknown> }>;
        };
      };
      expect(parsed.storage.storageHash).toBe(v2.headRef.hash);
      expect(Object.keys(parsed.storage.tables[EQL_V2_CONFIGURATION_TABLE]!.columns)).toContain(
        'audit_column',
      );
    });

    it('the v2 migration directory is created exactly once', () => {
      expect(bumpResult.written).toEqual([v2.migrations[1]!.dirName]);
      expect(bumpResult.skipped).toEqual([v2.migrations[0]!.dirName]);
    });

    it('the previously-emitted v1 baseline directory is byte-untouched', async () => {
      const after = {
        migration: await readFile(join(v1BaselineDir, 'migration.json')),
        ops: await readFile(join(v1BaselineDir, 'ops.json')),
        contract: await readFile(join(v1BaselineDir, 'contract.json')),
      };
      expect(after.migration.equals(v1BaselineFiles.migration)).toBe(true);
      expect(after.ops.equals(v1BaselineFiles.ops)).toBe(true);
      expect(after.contract.equals(v1BaselineFiles.contract)).toBe(true);
    });

    it('the new migration directory carries the audit-column op + invariantId', async () => {
      const newDir = join(fixture.cipherstashSpaceDir, v2.migrations[1]!.dirName);
      const opsRaw = await readFile(join(newDir, 'ops.json'), 'utf-8');
      const opsParsed = JSON.parse(opsRaw) as ReadonlyArray<{ readonly invariantId?: string }>;
      expect(opsParsed.map((op) => op.invariantId)).toContain('cipherstash:add-audit-column-v1');

      const manifestRaw = await readFile(join(newDir, 'migration.json'), 'utf-8');
      const manifest = JSON.parse(manifestRaw) as {
        readonly from: string | null;
        readonly to: string;
        readonly providedInvariants: readonly string[];
      };
      expect(manifest.from).toBe(v1.headRef.hash);
      expect(manifest.to).toBe(v2.headRef.hash);
      expect(manifest.providedInvariants).toEqual(['cipherstash:add-audit-column-v1']);
    });

    it('a second bump-pass against v2 is a complete no-op (idempotency over the bump)', async () => {
      const second = await rematerialiseAll(fixture, v2);
      expect(second.written).toEqual([]);
      expect(second.skipped).toEqual(v2.migrations.map((p) => p.dirName));

      const dirEntries = (await readdir(fixture.cipherstashSpaceDir)).sort();
      expect(dirEntries).toContain(v2.migrations[0]!.dirName);
      expect(dirEntries).toContain(v2.migrations[1]!.dirName);
    });
  });
});
