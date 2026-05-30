/**
 * Structural verification for the CipherStash extension descriptor.
 *
 * **Contract-space package layout.** The descriptor's
 * contract / migrations / head ref now flow through JSON-import
 * declarations from the package's emitted artefacts:
 *
 *   - `<package>/contract.json`
 *   - `<package>/migrations/<dirName>/{migration,ops}.json`
 *   - `<package>/refs/head.json`
 *
 * These assertions lock down the wiring: the descriptor exposes
 * structurally correct values; the emitted bundle SQL flows through
 * `ops.json` byte-for-byte; and the head ref tracks the latest
 * migration's `to` hash.
 *
 * Hash-level values are sourced from the on-disk artefacts (via the
 * descriptor's contractSpace) rather than hand-pinned in the test, so
 * the assertions stay honest under re-emission. Mirrors the synthetic
 * extension's `test/descriptor.test.ts` reference model.
 *
 * @see docs/architecture docs/adrs/ADR 212 - Contract spaces.md
 */

import { getStorageNamespace } from '@prisma-next/framework-components/ir';
import { assertDescriptorSelfConsistency } from '@prisma-next/migration-tools/spaces';
import { sqlContractCanonicalizationHooks } from '@prisma-next/sql-contract/canonicalization-hooks';
import type { SqlNamespace } from '@prisma-next/sql-contract/types';
import { describe, expect, it } from 'vitest';
import cipherstashExtensionDescriptor from '../src/exports/control';
import {
  CIPHERSTASH_BASELINE_MIGRATION_NAME,
  CIPHERSTASH_INVARIANTS,
  CIPHERSTASH_SPACE_ID,
  EQL_V2_CONFIGURATION_TABLE,
} from '../src/extension-metadata/constants';
import { EQL_BUNDLE_SQL } from '../src/migration/eql-bundle';

describe('cipherstash extension descriptor (contract-space package layout)', () => {
  it('identifies as a SQL extension targeted at postgres', () => {
    expect(cipherstashExtensionDescriptor).toMatchObject({
      kind: 'extension',
      id: CIPHERSTASH_SPACE_ID,
      familyId: 'sql',
      targetId: 'postgres',
    });
  });

  it('exposes a contractSpace declaring the eql_v2_configuration table', () => {
    const space = cipherstashExtensionDescriptor.contractSpace;
    expect(space).toBeDefined();
    const unboundTables =
      getStorageNamespace<SqlNamespace>(space!.contractJson.storage, '__unbound__')?.tables ?? {};
    expect(Object.keys(unboundTables)).toEqual([EQL_V2_CONFIGURATION_TABLE]);
  });

  it('publishes one baseline migration sourced from the on-disk emit pipeline', () => {
    const space = cipherstashExtensionDescriptor.contractSpace!;
    expect(space.migrations).toHaveLength(1);
    const baseline = space.migrations[0]!;
    expect(baseline.dirName).toBe(CIPHERSTASH_BASELINE_MIGRATION_NAME);
    expect(baseline.metadata.from).toBeNull();
    expect(baseline.metadata.to).toBe(space.contractJson.storage.storageHash);
  });

  it('baseline ops carry the installEqlBundle op + structural create-* ops', () => {
    const space = cipherstashExtensionDescriptor.contractSpace!;
    const baseline = space.migrations[0]!;
    const opIds = baseline.ops.map((op) => op.invariantId).filter(Boolean);
    expect(opIds).toEqual([CIPHERSTASH_INVARIANTS.installBundle]);
  });

  it('namespaces every baseline op invariantId under cipherstash:*', () => {
    const baseline = cipherstashExtensionDescriptor.contractSpace!.migrations[0]!;
    const ids = baseline.ops.map((op) => op.invariantId).filter(Boolean);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(id).toMatch(/^cipherstash:/);
    }
  });

  it('inlines the EQL bundle SQL byte-for-byte through ops.json', () => {
    const baseline = cipherstashExtensionDescriptor.contractSpace!.migrations[0]!;
    const installOp = baseline.ops.find(
      (op) => op.invariantId === CIPHERSTASH_INVARIANTS.installBundle,
    ) as { readonly execute?: ReadonlyArray<{ readonly sql: string }> } | undefined;
    expect(installOp).toBeDefined();
    expect(installOp?.execute?.[0]?.sql).toBe(EQL_BUNDLE_SQL);
  });

  it("points the head ref at the latest migration's destination hash", () => {
    const space = cipherstashExtensionDescriptor.contractSpace!;
    expect(space.headRef.hash).toBe(space.migrations[0]!.metadata.to);
    expect([...space.headRef.invariants].sort()).toEqual(
      [...space.migrations[0]!.metadata.providedInvariants].sort(),
    );
  });

  it('self-consistency check passes — headRef.hash matches re-derived storage hash', () => {
    const space = cipherstashExtensionDescriptor.contractSpace!;
    expect(() =>
      assertDescriptorSelfConsistency({
        extensionId: CIPHERSTASH_SPACE_ID,
        target: space.contractJson.target,
        targetFamily: space.contractJson.targetFamily,
        storage: space.contractJson.storage as unknown as Record<string, unknown>,
        headRefHash: space.headRef.hash,
        ...sqlContractCanonicalizationHooks,
      }),
    ).not.toThrow();
  });
});
