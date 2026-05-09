import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createSqlContract } from '@prisma-next/contract/testing';
import type { Contract } from '@prisma-next/contract/types';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type DeclaredExtensionEntry,
  type LoadAggregateInput,
  loadContractSpaceAggregate,
} from '../../src/aggregate/loader';
import { EMPTY_CONTRACT_HASH } from '../../src/constants';
import { emitContractSpaceArtefacts } from '../../src/emit-contract-space-artefacts';
import { spaceMigrationDirectory } from '../../src/space-layout';
import { writeTestPackage } from '../fixtures';

/**
 * Hash function used by the loader's drift-detection step. The tests
 * use a deterministic, content-based stub so they can predict the
 * descriptor hash without round-tripping through the SQL family's
 * canonical pipeline. The loader treats the hasher as opaque, so any
 * hash strategy is fine.
 */
function stubHash(value: unknown): string {
  return `sha256:test:${JSON.stringify(value)}`;
}

/**
 * Identity validator: returns the JSON value as a `Contract` (typed,
 * not validated). The loader's contract is that the validator either
 * returns a Contract or throws — both branches are exercised below.
 *
 * For the success path we hand back a typed `Contract` produced by
 * `createSqlContract` so downstream invariant checks
 * (`spaceContract.target`, table extraction) succeed.
 */
function makeIdentityValidator(byJson: ReadonlyMap<string, Contract>) {
  return (json: unknown): Contract => {
    const key = JSON.stringify(json);
    const contract = byJson.get(key);
    if (!contract) {
      throw new Error(`unexpected validator input: ${key.slice(0, 80)}`);
    }
    return contract;
  };
}

/**
 * Build a `LoadAggregateInput` with sensible defaults plus the supplied
 * overrides. Tests assemble the on-disk state separately and then point
 * the loader at the resulting `migrationsDir`.
 */
function buildInput(overrides: Partial<LoadAggregateInput>): LoadAggregateInput {
  const appContract = overrides.appContract ?? createSqlContract({ target: 'postgres' });
  return {
    targetId: 'postgres',
    migrationsDir: '',
    appContract,
    declaredExtensions: [],
    validateContract: makeIdentityValidator(new Map()),
    hashContract: stubHash,
    appMigrationPackages: [],
    ...overrides,
  };
}

describe('loadContractSpaceAggregate', () => {
  let migrationsDir: string;

  beforeEach(async () => {
    migrationsDir = await mkdtemp(join(tmpdir(), 'load-aggregate-'));
  });

  afterEach(async () => {
    await rm(migrationsDir, { recursive: true, force: true });
  });

  describe('targetMismatch', () => {
    it('reports targetMismatch when the app contract target differs from input.targetId', async () => {
      const result = await loadContractSpaceAggregate(
        buildInput({
          migrationsDir,
          targetId: 'postgres',
          appContract: createSqlContract({ target: 'sqlite' }),
        }),
      );
      expect(result.ok).toBe(false);
      expect(result.assertNotOk()).toEqual({
        kind: 'targetMismatch',
        spaceId: 'app',
        expected: 'postgres',
        actual: 'sqlite',
      });
    });

    it('reports targetMismatch when a declared extension targets a different database', async () => {
      const declaredExtension: DeclaredExtensionEntry = {
        id: 'cipherstash',
        targetId: 'sqlite',
        contractSpace: { contractJson: { id: 'cipher' } },
      };
      const result = await loadContractSpaceAggregate(
        buildInput({
          migrationsDir,
          targetId: 'postgres',
          declaredExtensions: [declaredExtension],
        }),
      );
      expect(result.ok).toBe(false);
      expect(result.assertNotOk()).toEqual({
        kind: 'targetMismatch',
        spaceId: 'cipherstash',
        expected: 'postgres',
        actual: 'sqlite',
      });
    });
  });

  describe('layoutViolation', () => {
    it('bundles every layout offence in a single layoutViolation', async () => {
      // Pin a directory for an extension the user did NOT declare in
      // extensionPacks — that's an orphanSpaceDir.
      await emitContractSpaceArtefacts(migrationsDir, 'orphan_ext', {
        contract: { id: 'orphan' },
        contractDts: '\n',
        headRef: { hash: EMPTY_CONTRACT_HASH, invariants: [] },
      });

      // Declare an extension with a contract space that has NO on-disk
      // directory on disk — that's a declaredButUnmigrated.
      const result = await loadContractSpaceAggregate(
        buildInput({
          migrationsDir,
          declaredExtensions: [
            {
              id: 'unmigrated_ext',
              targetId: 'postgres',
              contractSpace: { contractJson: { id: 'unmigrated' } },
            },
          ],
        }),
      );

      expect(result.ok).toBe(false);
      const failure = result.assertNotOk();
      expect(failure.kind).toBe('layoutViolation');
      if (failure.kind !== 'layoutViolation') return;
      // Both offences are surfaced in one error rather than fixed one
      // commit at a time (preserves the M2 R6 R3 verifier behaviour).
      expect([...failure.violations].sort((a, b) => a.spaceId.localeCompare(b.spaceId))).toEqual([
        { kind: 'orphanSpaceDir', spaceId: 'orphan_ext' },
        { kind: 'declaredButUnmigrated', spaceId: 'unmigrated_ext' },
      ]);
    });
  });

  describe('integrityFailure', () => {
    it('reports integrityFailure when refs/head.json is missing for a declared extension', async () => {
      // Create the contract-space dir minus the head.json — `readContractSpaceHeadRef`
      // returns null and the loader treats this as integrity (the layout
      // precheck only sees the directory exists).
      const dir = join(migrationsDir, 'cipherstash');
      // Layout precheck looks for the directory, but readContractSpaceHeadRef
      // returns null when refs/head.json doesn't exist; the loader then
      // surfaces it as integrityFailure (not layoutViolation).
      const { mkdir, writeFile } = await import('node:fs/promises');
      await mkdir(dir, { recursive: true });
      // Write contract.json so readContractSpaceContract doesn't fire first;
      // and write a placeholder so listContractSpaceDirectories sees it.
      await writeFile(join(dir, 'contract.json'), '{}');

      const declaredExtension: DeclaredExtensionEntry = {
        id: 'cipherstash',
        targetId: 'postgres',
        contractSpace: { contractJson: { id: 'cipher' } },
      };
      const result = await loadContractSpaceAggregate(
        buildInput({
          migrationsDir,
          declaredExtensions: [declaredExtension],
        }),
      );
      expect(result.ok).toBe(false);
      const failure = result.assertNotOk();
      expect(failure.kind).toBe('integrityFailure');
      if (failure.kind !== 'integrityFailure') return;
      expect(failure.spaceId).toBe('cipherstash');
      expect(failure.detail).toContain('refs/head.json');
    });

    it('reports integrityFailure when the on-disk head ref is not in the on-disk migration graph', async () => {
      // Pin a head ref whose hash matches the descriptor's hash (so
      // drift does not fire) but that no migration package walks to.
      const cipherContract = { id: 'cipher' };
      const priorHeadHash = stubHash(cipherContract);
      await emitContractSpaceArtefacts(migrationsDir, 'cipherstash', {
        contract: cipherContract,
        contractDts: '\n',
        headRef: {
          hash: priorHeadHash,
          invariants: [],
        },
      });
      // Write a single migration package whose `to` is something else;
      // this leaves the graph non-empty but missing the on-disk head hash.
      await writeTestPackage(
        join(spaceMigrationDirectory(migrationsDir, 'cipherstash'), '20260101T0000_init'),
        { from: null, to: 'sha256:cipher-real-head' },
      );

      const validator = makeIdentityValidator(
        new Map([[JSON.stringify(cipherContract), createSqlContract({ target: 'postgres' })]]),
      );
      const result = await loadContractSpaceAggregate(
        buildInput({
          migrationsDir,
          validateContract: validator,
          hashContract: stubHash,
          declaredExtensions: [
            {
              id: 'cipherstash',
              targetId: 'postgres',
              contractSpace: { contractJson: cipherContract },
            },
          ],
        }),
      );
      expect(result.ok).toBe(false);
      const failure = result.assertNotOk();
      expect(failure.kind).toBe('integrityFailure');
      if (failure.kind !== 'integrityFailure') return;
      expect(failure.spaceId).toBe('cipherstash');
      expect(failure.detail).toContain('not present in the on-disk migration graph');
    });
  });

  describe('validationFailure', () => {
    it('reports validationFailure when the on-disk contract.json fails validation', async () => {
      const cipherContract = { id: 'cipher' };
      await emitContractSpaceArtefacts(migrationsDir, 'cipherstash', {
        contract: cipherContract,
        contractDts: '\n',
        headRef: { hash: EMPTY_CONTRACT_HASH, invariants: [] },
      });

      // Validator throws for the on-disk contract — simulates ArkType
      // surfacing a structural failure for a corrupt contract.json.
      const failingValidator = (_json: unknown): Contract => {
        throw new Error('storage.tables.users is missing');
      };

      const result = await loadContractSpaceAggregate(
        buildInput({
          migrationsDir,
          validateContract: failingValidator,
          declaredExtensions: [
            {
              id: 'cipherstash',
              targetId: 'postgres',
              contractSpace: { contractJson: cipherContract },
            },
          ],
        }),
      );
      expect(result.ok).toBe(false);
      const failure = result.assertNotOk();
      expect(failure.kind).toBe('validationFailure');
      if (failure.kind !== 'validationFailure') return;
      expect(failure.spaceId).toBe('cipherstash');
      expect(failure.detail).toContain('storage.tables.users is missing');
    });
  });

  describe('driftViolation', () => {
    it('reports driftViolation (fatal) when descriptor hash differs from the on-disk head hash', async () => {
      const spaceContractJson = { id: 'cipher', version: 1 };
      const liveJson = { id: 'cipher', version: 2 };

      // The framework's emit pipeline normally writes the same hash that
      // matches the descriptor's contract; here we simulate post-emit
      // drift by pinning a stale hash.
      await emitContractSpaceArtefacts(migrationsDir, 'cipherstash', {
        contract: spaceContractJson,
        contractDts: '\n',
        headRef: { hash: stubHash(spaceContractJson), invariants: [] },
      });

      const validator = makeIdentityValidator(
        new Map([
          [JSON.stringify(spaceContractJson), createSqlContract({ target: 'postgres' })],
          [JSON.stringify(liveJson), createSqlContract({ target: 'postgres' })],
        ]),
      );

      const result = await loadContractSpaceAggregate(
        buildInput({
          migrationsDir,
          validateContract: validator,
          hashContract: stubHash,
          declaredExtensions: [
            {
              id: 'cipherstash',
              targetId: 'postgres',
              contractSpace: { contractJson: liveJson },
            },
          ],
        }),
      );

      expect(result.ok).toBe(false);
      const failure = result.assertNotOk();
      expect(failure.kind).toBe('driftViolation');
      if (failure.kind !== 'driftViolation') return;
      expect(failure.spaceId).toBe('cipherstash');
      expect(failure.priorHeadHash).toBe(stubHash(spaceContractJson));
      expect(failure.liveHash).toBe(stubHash(liveJson));
    });
  });

  describe('disjointnessViolation', () => {
    it('reports disjointnessViolation when two members claim the same storage element', async () => {
      // App claims `users`; extension claims `users` as well.
      const appContract = createSqlContract({
        target: 'postgres',
        storage: { tables: { users: {} } },
      });
      const extContract = createSqlContract({
        target: 'postgres',
        storage: { tables: { users: {} } },
      });

      const cipherJson = { id: 'cipher-collides' };
      const cipherHeadHash = stubHash(cipherJson);
      await emitContractSpaceArtefacts(migrationsDir, 'cipherstash', {
        contract: cipherJson,
        contractDts: '\n',
        headRef: { hash: cipherHeadHash, invariants: [] },
      });
      // Migration so the graph contains the on-disk head ref node.
      await writeTestPackage(
        join(spaceMigrationDirectory(migrationsDir, 'cipherstash'), '20260101T0000_init'),
        { from: null, to: cipherHeadHash },
      );

      const validator = makeIdentityValidator(new Map([[JSON.stringify(cipherJson), extContract]]));

      const result = await loadContractSpaceAggregate(
        buildInput({
          migrationsDir,
          appContract,
          validateContract: validator,
          hashContract: stubHash,
          declaredExtensions: [
            {
              id: 'cipherstash',
              targetId: 'postgres',
              contractSpace: { contractJson: cipherJson },
            },
          ],
        }),
      );

      expect(result.ok).toBe(false);
      const failure = result.assertNotOk();
      expect(failure.kind).toBe('disjointnessViolation');
      if (failure.kind !== 'disjointnessViolation') return;
      expect(failure.element).toBe('users');
      expect([...failure.claimedBy].sort()).toEqual(['app', 'cipherstash']);
    });
  });

  describe('success path', () => {
    it('returns a fully hydrated aggregate with extensions sorted alphabetically by spaceId', async () => {
      // Two extensions, declared in non-alphabetical order. The
      // resulting `aggregate.extensions` must be sorted alphabetically
      // because downstream `applyOrder` invariants (and the existing
      // `concatenateSpaceApplyInputs` ordering) rely on it.
      const cipherJson = { id: 'cipher' };
      const pgvectorJson = { id: 'pgvector' };
      // Pin head hashes that match `stubHash(contractJson)` so drift
      // detection passes. Both extensions point at the empty-contract
      // sentinel because no migrations have been authored yet — the
      // loader tolerates an empty graph when the head ref equals
      // EMPTY_CONTRACT_HASH (greenfield extensions).
      const cipherHeadHash = stubHash(cipherJson);
      const pgvectorHeadHash = stubHash(pgvectorJson);
      await emitContractSpaceArtefacts(migrationsDir, 'cipherstash', {
        contract: cipherJson,
        contractDts: '\n',
        headRef: {
          hash: cipherHeadHash,
          invariants: ['cipher:create-v1', 'a-cipher-inv'],
        },
      });
      await emitContractSpaceArtefacts(migrationsDir, 'pgvector', {
        contract: pgvectorJson,
        contractDts: '\n',
        headRef: {
          hash: pgvectorHeadHash,
          invariants: [],
        },
      });
      // Migrations so each space's graph contains the on-disk head ref.
      await writeTestPackage(
        join(spaceMigrationDirectory(migrationsDir, 'cipherstash'), '20260101T0000_init'),
        { from: null, to: cipherHeadHash },
      );
      await writeTestPackage(
        join(spaceMigrationDirectory(migrationsDir, 'pgvector'), '20260101T0000_init'),
        { from: null, to: pgvectorHeadHash },
      );

      const cipherContract = createSqlContract({
        target: 'postgres',
        storage: { tables: { cipher_state: {} } },
      });
      const pgvectorContract = createSqlContract({
        target: 'postgres',
        storage: { tables: { pgvector_state: {} } },
      });
      const validator = makeIdentityValidator(
        new Map([
          [JSON.stringify(cipherJson), cipherContract],
          [JSON.stringify(pgvectorJson), pgvectorContract],
        ]),
      );

      const result = await loadContractSpaceAggregate(
        buildInput({
          migrationsDir,
          targetId: 'postgres',
          appContract: createSqlContract({
            target: 'postgres',
            storage: { tables: { app_user: {} } },
          }),
          validateContract: validator,
          hashContract: stubHash,
          declaredExtensions: [
            // Declaration order does NOT determine apply order.
            {
              id: 'pgvector',
              targetId: 'postgres',
              contractSpace: { contractJson: pgvectorJson },
            },
            {
              id: 'cipherstash',
              targetId: 'postgres',
              contractSpace: { contractJson: cipherJson },
            },
          ],
        }),
      );

      expect(result.ok).toBe(true);
      const { aggregate } = result.assertOk();

      expect(aggregate.targetId).toBe('postgres');
      expect(aggregate.app.spaceId).toBe('app');
      // Extensions are alphabetical; matches `concatenateSpaceApplyInputs`.
      expect(aggregate.extensions.map((e) => e.spaceId)).toEqual(['cipherstash', 'pgvector']);

      const cipherMember = aggregate.extensions[0];
      // headRef.invariants must be sorted (defensive) and member-shape
      // complete.
      expect(cipherMember?.headRef.invariants).toEqual(['a-cipher-inv', 'cipher:create-v1']);
      expect(cipherMember?.contract).toBe(cipherContract);
      expect(cipherMember?.headRef.hash).toBe(cipherHeadHash);
      // Graph is hydrated from the on-disk packages: one migration
      // package implies two nodes (EMPTY_CONTRACT_HASH source plus the
      // head ref target).
      expect(cipherMember?.migrations.graph.nodes.has(cipherHeadHash)).toBe(true);
      expect(cipherMember?.migrations.graph.nodes.has(EMPTY_CONTRACT_HASH)).toBe(true);
      expect(cipherMember?.migrations.packagesByMigrationHash.size).toBe(1);

      // App member is hydrated from the caller-supplied packages (none
      // here = empty graph).
      expect(aggregate.app.migrations.graph.nodes.size).toBe(0);
      expect(aggregate.app.migrations.packagesByMigrationHash.size).toBe(0);
    });
  });
});
