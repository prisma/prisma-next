/**
 * Structural verification for the CipherStash extension descriptor.
 *
 * R1's verification surface (per `projects/extension-contract-spaces/plan.md`
 * § "M3 — Tasks T3.1 → T3.3"):
 *   - the descriptor's `contractSpace` field is wired and shaped correctly;
 *   - the contract IR enumerates the typed objects R1 ships
 *     (project AC8 / TC-13 — partial coverage; composite/enum/domain IR
 *     vocabulary deferred — see contract.ts deferral block);
 *   - the baseline migration carries the `installEqlBundle` op + the
 *     create-* ops with stable `cipherstash:*` invariantIds (project AC7 /
 *     TC-12 at the structural level — bundle byte-equality lands when the
 *     real EQL bundle SQL is vendored);
 *   - the descriptor is self-consistent (`headRef.hash` matches a
 *     re-derived `computeStorageHash(...)` over `(target, targetFamily,
 *     storage)` — same check the family runs at create-time via
 *     `assertDescriptorSelfConsistency`).
 *
 * This file is a fast in-process check; the live-database e2e (sub-spec
 * § 6 Scenarios A–D) lands in M3 R2+.
 */

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
import { CIPHERSTASH_STORAGE_HASH } from '../src/core/contract';
import { CIPHERSTASH_BASELINE_INVARIANTS } from '../src/core/migrations';
import cipherstashExtensionDescriptor from '../src/exports/control';

describe('cipherstash extension descriptor', () => {
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

  it('records the deferred composite/enum/domain typed objects under meta.cipherstashFutureIR', () => {
    const meta = cipherstashExtensionDescriptor.contractSpace!.contractJson.meta;
    const future = (meta as { readonly cipherstashFutureIR?: unknown }).cipherstashFutureIR;
    expect(future).toBeDefined();
    expect(future).toMatchObject({
      compositeTypes: expect.any(Array),
      enums: expect.any(Array),
      domains: expect.any(Array),
    });
  });

  it('publishes one baseline migration containing the installEqlBundle op + structural create-* ops', () => {
    const space = cipherstashExtensionDescriptor.contractSpace!;
    expect(space.migrations).toHaveLength(1);
    const baseline = space.migrations[0]!;
    expect(baseline.dirName).toBe(CIPHERSTASH_BASELINE_MIGRATION_NAME);

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

  it('points the head ref at the storage-hash of the published contract', () => {
    const headRef = cipherstashExtensionDescriptor.contractSpace!.headRef;
    expect(headRef.hash).toBe(CIPHERSTASH_STORAGE_HASH);
    expect(headRef.invariants).toEqual(CIPHERSTASH_BASELINE_INVARIANTS);
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
