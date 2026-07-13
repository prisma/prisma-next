/**
 * Structural verification for the better-auth extension pack descriptor.
 *
 * The descriptor's contract / migrations / head ref flow through
 * JSON-import declarations from the package's emitted artefacts:
 *
 *   - `<package>/src/contract/contract.json`
 *   - `<package>/migrations/<dirName>/{migration,ops}.json`
 *   - `<package>/migrations/refs/head.json`
 *
 * These assertions lock down the wiring: the descriptor exposes the four
 * BetterAuth core tables in the `public` namespace with their uniques and
 * foreign keys; the baseline migration walks the empty database to the
 * contract's storage hash; and the head ref tracks the latest migration.
 *
 * Hash-level values are sourced from the on-disk artefacts (via the
 * descriptor's contractSpace) rather than hand-pinned in the test, so the
 * assertions stay honest under re-emission.
 *
 * @see docs/architecture docs/adrs/ADR 212 - Contract spaces.md
 */

import { assertDescriptorSelfConsistency } from '@prisma-next/migration-tools/spaces';
import { sqlContractCanonicalizationHooks } from '@prisma-next/sql-contract/canonicalization-hooks';
import { describe, expect, it } from 'vitest';
import betterAuthPack from '../src/exports/pack';

const CORE_TABLES = ['account', 'session', 'user', 'verification'] as const;

interface TableEntry {
  readonly columns: Record<string, { readonly nullable: boolean; readonly codecId: string }>;
  readonly uniques: ReadonlyArray<{ readonly columns: readonly string[] }>;
  readonly foreignKeys?: ReadonlyArray<{
    readonly source: { readonly tableName: string; readonly columns: readonly string[] };
    readonly target: { readonly tableName: string; readonly columns: readonly string[] };
  }>;
  readonly primaryKey: { readonly columns: readonly string[] };
}

function publicTables(): Record<string, TableEntry> {
  const space = betterAuthPack.contractSpace;
  expect(space).toBeDefined();
  const namespaces = space!.contractJson.storage.namespaces as Record<
    string,
    { readonly entries: { readonly table: Record<string, TableEntry> } }
  >;
  return namespaces['public']!.entries.table;
}

describe('better-auth extension pack descriptor', () => {
  it('identifies as a SQL extension targeted at postgres', () => {
    expect(betterAuthPack).toMatchObject({
      kind: 'extension',
      id: 'better-auth',
      familyId: 'sql',
      targetId: 'postgres',
    });
  });

  it('defines the four BetterAuth core tables in the public namespace', () => {
    expect(Object.keys(publicTables()).sort()).toEqual([...CORE_TABLES]);
  });

  it('gives every table a text primary key and timestamptz createdAt/updatedAt', () => {
    const tables = publicTables();
    for (const name of CORE_TABLES) {
      const table = tables[name]!;
      expect(table.primaryKey.columns).toEqual(['id']);
      expect(table.columns['id']).toMatchObject({ codecId: 'pg/text@1', nullable: false });
      expect(table.columns['createdAt']).toMatchObject({
        codecId: 'pg/timestamptz@1',
        nullable: false,
      });
      expect(table.columns['updatedAt']).toMatchObject({
        codecId: 'pg/timestamptz@1',
        nullable: false,
      });
    }
  });

  it('declares unique constraints on user.email and session.token', () => {
    const tables = publicTables();
    expect(tables['user']!.uniques).toEqual([{ columns: ['email'] }]);
    expect(tables['session']!.uniques).toEqual([{ columns: ['token'] }]);
  });

  it('declares cascading foreign keys session.userId → user.id and account.userId → user.id', () => {
    const tables = publicTables();
    for (const child of ['session', 'account'] as const) {
      expect(tables[child]!.foreignKeys).toEqual([
        expect.objectContaining({
          source: expect.objectContaining({ tableName: child, columns: ['userId'] }),
          target: expect.objectContaining({ tableName: 'user', columns: ['id'] }),
          // BetterAuth's canonical schema cascades user deletions.
          onDelete: 'cascade',
        }),
      ]);
    }
  });

  it('exposes navigable N:1 relations from Session and Account to User', () => {
    const domain = betterAuthPack.contractSpace!.contractJson.domain as {
      readonly namespaces: Record<
        string,
        {
          readonly models: Record<
            string,
            { readonly relations?: Record<string, { readonly cardinality: string }> }
          >;
        }
      >;
    };
    const models = domain.namespaces['public']!.models;
    expect(models['Session']!.relations?.['user']).toMatchObject({ cardinality: 'N:1' });
    expect(models['Account']!.relations?.['user']).toMatchObject({ cardinality: 'N:1' });
  });

  it('publishes one baseline migration walking null → storageHash', () => {
    const space = betterAuthPack.contractSpace!;
    expect(space.migrations).toHaveLength(1);
    const baseline = space.migrations[0]!;
    expect(baseline.metadata.from).toBeNull();
    expect(baseline.metadata.to).toBe(space.contractJson.storage.storageHash);
    expect(baseline.ops.length).toBeGreaterThan(0);
  });

  it('baseline ops create all four tables', () => {
    const baseline = betterAuthPack.contractSpace!.migrations[0]!;
    const tableOps = baseline.ops
      .map(
        (op) =>
          op as {
            readonly target?: {
              readonly details?: { readonly objectType?: string; readonly name?: string };
            };
          },
      )
      .filter((op) => op.target?.details?.objectType === 'table')
      .map((op) => op.target?.details?.name);
    for (const table of CORE_TABLES) {
      expect(tableOps).toContain(table);
    }
  });

  it("points the head ref at the latest migration's destination hash", () => {
    const space = betterAuthPack.contractSpace!;
    expect(space.headRef.hash).toBe(space.migrations[0]!.metadata.to);
    expect([...space.headRef.invariants].sort()).toEqual(
      [...space.migrations[0]!.metadata.providedInvariants].sort(),
    );
  });

  it('self-consistency check passes — headRef.hash matches re-derived storage hash', () => {
    const space = betterAuthPack.contractSpace!;
    expect(() =>
      assertDescriptorSelfConsistency({
        extensionId: 'better-auth',
        target: space.contractJson.target,
        targetFamily: space.contractJson.targetFamily,
        storage: space.contractJson.storage as unknown as Record<string, unknown>,
        headRefHash: space.headRef.hash,
        ...sqlContractCanonicalizationHooks,
      }),
    ).not.toThrow();
  });
});
