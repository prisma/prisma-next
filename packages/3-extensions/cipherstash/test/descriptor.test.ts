/**
 * Structural verification for the CipherStash extension descriptor.
 *
 * **On-disk-in-package authoring (M3.5 R2).** The descriptor's
 * contract / migrations / head ref now flow through JSON-import
 * declarations from the package's emitted artefacts:
 *
 *   - `<package>/contract.json`
 *   - `<package>/migrations/cipherstash/<dirName>/{migration,ops}.json`
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
 * @see docs/architecture docs/adrs/ADR 211 - Contract spaces.md
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { assertDescriptorSelfConsistency } from '@prisma-next/migration-tools/spaces';
import { describe, expect, it } from 'vitest';
import {
  CIPHERSTASH_BASELINE_MIGRATION_NAME,
  CIPHERSTASH_INVARIANTS,
  CIPHERSTASH_SPACE_ID,
  EQL_V2_CONFIGURATION_TABLE,
  EQL_V2_DOMAIN_TYPES,
  EQL_V2_ORE_COMPOSITE_TYPES,
} from '../src/core/constants';
import { EQL_BUNDLE_SQL } from '../src/core/eql-bundle';
import cipherstashExtensionDescriptor from '../src/exports/control';

describe('cipherstash extension descriptor (on-disk-in-package authoring)', () => {
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
    expect(Object.keys(space!.contractJson.storage.tables)).toEqual([EQL_V2_CONFIGURATION_TABLE]);
  });

  it('publishes one baseline migration sourced from the on-disk emit pipeline', () => {
    const space = cipherstashExtensionDescriptor.contractSpace!;
    expect(space.migrations).toHaveLength(1);
    const baseline = space.migrations[0]!;
    expect(baseline.dirName).toBe(CIPHERSTASH_BASELINE_MIGRATION_NAME);
    expect(baseline.metadata.from).toBeNull();
    expect(baseline.metadata.to).toBe(space.contractJson.storage.storageHash);
  });

  it("synthesises the migration package's `dirPath` from the descriptor's URL", () => {
    const baseline = cipherstashExtensionDescriptor.contractSpace!.migrations[0]!;
    expect(existsSync(baseline.dirPath)).toBe(true);
    expect(existsSync(join(baseline.dirPath, 'migration.json'))).toBe(true);
    expect(existsSync(join(baseline.dirPath, 'ops.json'))).toBe(true);
  });

  it('baseline ops carry the installEqlBundle op + structural create-* ops', () => {
    const space = cipherstashExtensionDescriptor.contractSpace!;
    const baseline = space.migrations[0]!;
    const opIds = baseline.ops.map((op) => op.invariantId).filter(Boolean);
    expect(opIds).toContain(CIPHERSTASH_INVARIANTS.installBundle);
    expect(opIds).toContain(CIPHERSTASH_INVARIANTS.createConfiguration);
    expect(opIds).toContain(CIPHERSTASH_INVARIANTS.createConfigurationState);
    expect(opIds).toContain(CIPHERSTASH_INVARIANTS.createEncrypted);
    for (const name of EQL_V2_DOMAIN_TYPES) {
      expect(opIds).toContain(CIPHERSTASH_INVARIANTS.createDomain(name));
    }
    for (const name of EQL_V2_ORE_COMPOSITE_TYPES) {
      expect(opIds).toContain(CIPHERSTASH_INVARIANTS.createOreComposite(name));
    }
  });

  it('namespaces every baseline op invariantId under cipherstash:*', () => {
    const baseline = cipherstashExtensionDescriptor.contractSpace!.migrations[0]!;
    const ids = baseline.ops.map((op) => op.invariantId).filter(Boolean);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(id).toMatch(/^cipherstash:/);
    }
  });

  it('inlines the EQL bundle SQL byte-for-byte through ops.json (AC-7)', () => {
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
      }),
    ).not.toThrow();
  });
});
