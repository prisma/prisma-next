/**
 * Structural verification for the pgvector extension descriptor on the
 * contract-space mechanism (project: extension-contract-spaces, M4
 * T4.1 + T4.2).
 *
 * Pins:
 *   - the descriptor's `contractSpace` field is wired and shaped
 *     correctly (project AC10 / TC-15);
 *   - the contract IR declares the parameterised native `vector` type
 *     under `storage.types` (project FR9 / TC-15 — pgvector's vector
 *     IS representable in today's IR vocabulary, unlike CipherStash's
 *     deferred composite/enum/domain typed objects);
 *   - the baseline migration carries the `installVectorExtension` op
 *     with the stable `pgvector:install-vector-v1` invariantId
 *     (project FR11 / FR15);
 *   - the descriptor is self-consistent (`headRef.hash` matches a
 *     re-derived `computeStorageHash(...)` over `(target,
 *     targetFamily, storage)` — same check the family runs at
 *     create-time via `assertDescriptorSelfConsistency`).
 *
 * This file is a fast in-process check; live-database e2e against
 * pgvector lives in `test/scenario-a.e2e.integration.test.ts` (T4.3).
 */

import { assertDescriptorSelfConsistency } from '@prisma-next/migration-tools/spaces';
import { describe, expect, it } from 'vitest';
import { VECTOR_CODEC_ID } from '../src/core/constants';
import { PGVECTOR_STORAGE_HASH } from '../src/core/contract';
import {
  PGVECTOR_BASELINE_MIGRATION_NAME,
  PGVECTOR_INVARIANTS,
  PGVECTOR_NATIVE_TYPE,
  PGVECTOR_SPACE_ID,
} from '../src/core/contract-space-constants';
import { PGVECTOR_BASELINE_INVARIANTS } from '../src/core/migrations';
import pgvectorExtensionDescriptor from '../src/exports/control';

describe('pgvector extension descriptor (contract space)', () => {
  it('identifies as a SQL extension targeted at postgres', () => {
    expect(pgvectorExtensionDescriptor).toMatchObject({
      kind: 'extension',
      id: PGVECTOR_SPACE_ID,
      familyId: 'sql',
      targetId: 'postgres',
    });
  });

  it('exposes a contractSpace declaring the vector parameterised native type', () => {
    const space = pgvectorExtensionDescriptor.contractSpace;
    expect(space).toBeDefined();
    expect(Object.keys(space!.contractJson.storage.tables)).toEqual([]);
    expect(space!.contractJson.storage.types).toBeDefined();
    expect(space!.contractJson.storage.types?.[PGVECTOR_NATIVE_TYPE]).toMatchObject({
      codecId: VECTOR_CODEC_ID,
      nativeType: PGVECTOR_NATIVE_TYPE,
    });
  });

  it('publishes one baseline migration containing the installVectorExtension op', () => {
    const space = pgvectorExtensionDescriptor.contractSpace!;
    expect(space.migrations).toHaveLength(1);
    const baseline = space.migrations[0]!;
    expect(baseline.dirName).toBe(PGVECTOR_BASELINE_MIGRATION_NAME);

    const opIds = baseline.ops.map((op) => op.invariantId).filter(Boolean);
    expect(opIds).toEqual([PGVECTOR_INVARIANTS.installVector]);
  });

  it('namespaces every baseline op invariantId under pgvector:*', () => {
    const baseline = pgvectorExtensionDescriptor.contractSpace!.migrations[0]!;
    const ids = baseline.ops.map((op) => op.invariantId).filter(Boolean);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(id).toMatch(/^pgvector:/);
    }
  });

  it('the install-vector op carries the legacy CREATE EXTENSION DDL + postcondition', () => {
    const baseline = pgvectorExtensionDescriptor.contractSpace!.migrations[0]!;
    const installOp = baseline.ops.find(
      (op) => op.invariantId === PGVECTOR_INVARIANTS.installVector,
    ) as
      | {
          readonly precheck?: ReadonlyArray<{ readonly sql: string }>;
          readonly execute?: ReadonlyArray<{ readonly sql: string }>;
          readonly postcheck?: ReadonlyArray<{ readonly sql: string }>;
        }
      | undefined;
    expect(installOp).toBeDefined();
    expect(installOp!.execute?.[0]?.sql).toBe('CREATE EXTENSION IF NOT EXISTS vector');
    expect(installOp!.postcheck?.[0]?.sql).toContain("extname = 'vector'");
    expect(installOp!.precheck?.[0]?.sql).toContain("extname = 'vector'");
  });

  it('points the head ref at the storage-hash of the published contract', () => {
    const headRef = pgvectorExtensionDescriptor.contractSpace!.headRef;
    expect(headRef.hash).toBe(PGVECTOR_STORAGE_HASH);
    expect(headRef.invariants).toEqual(PGVECTOR_BASELINE_INVARIANTS);
  });

  it('self-consistency check passes — headRef.hash matches re-derived storage hash', () => {
    const space = pgvectorExtensionDescriptor.contractSpace!;
    expect(() =>
      assertDescriptorSelfConsistency({
        extensionId: PGVECTOR_SPACE_ID,
        target: space.contractJson.target,
        targetFamily: space.contractJson.targetFamily,
        storage: space.contractJson.storage as unknown as Record<string, unknown>,
        headRefHash: space.headRef.hash,
      }),
    ).not.toThrow();
  });
});
