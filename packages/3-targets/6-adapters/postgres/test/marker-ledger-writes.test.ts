import { describe, expect, it } from 'vitest';
import { PostgresControlAdapter } from '../src/core/control-adapter';

interface CapturedCall {
  readonly sql: string;
  readonly params: readonly unknown[];
}

function createCapturingDriver(rows: Record<string, unknown>[] = []) {
  const calls: CapturedCall[] = [];
  return {
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    async query<Row = Record<string, unknown>>(sql: string, params?: readonly unknown[]) {
      calls.push({ sql, params: params ?? [] });
      return { rows: rows as Row[] };
    },
    async close() {},
    calls,
  };
}

describe('PostgresControlAdapter marker/ledger write lowering', () => {
  const adapter = new PostgresControlAdapter();

  it('initMarker lowers to an upsert keyed on space with DB-side updated_at', async () => {
    const driver = createCapturingDriver();
    await adapter.initMarker(driver, 'app', {
      storageHash: 'sha256:core',
      profileHash: 'sha256:prof',
      invariants: ['inv-a', 'inv-b'],
    });

    const { sql, params } = driver.calls[0]!;
    expect(sql).toContain(
      'INSERT INTO "prisma_contract"."marker" ("space", "core_hash", "profile_hash", ' +
        '"contract_json", "canonical_version", "updated_at", "app_tag", "meta", "invariants")',
    );
    expect(sql).toContain('VALUES ($1, $2, $3, $4::jsonb, $5, now(), $6, $7::jsonb, $8::text[])');
    expect(sql).toContain('ON CONFLICT ("space") DO UPDATE SET');
    expect(sql).toContain('"core_hash" = excluded."core_hash"');
    expect(sql).toContain('"updated_at" = now()');
    expect(sql).toContain('"invariants" = excluded."invariants"');
    expect(params[0]).toBe('app');
    expect(params[1]).toBe('sha256:core');
    expect(params[2]).toBe('sha256:prof');
    expect(params[7]).toEqual(['inv-a', 'inv-b']);
  });

  it('updateMarker reads the current invariants and writes the deduped union (no overwrite)', async () => {
    // The capturing driver returns this row for the internal readMarker probe
    // and select; a Postgres driver yields `invariants` as a string[] already.
    const driver = createCapturingDriver([
      { core_hash: 'sha256:from', profile_hash: 'sha256:prof', invariants: ['inv-a', 'inv-b'] },
    ]);
    const matched = await adapter.updateMarker(driver, 'app', 'sha256:from', {
      storageHash: 'sha256:to',
      profileHash: 'sha256:prof',
      invariants: ['inv-b', 'inv-c'],
    });

    const update = driver.calls.at(-1)!;
    expect(update.sql).toBe(
      'UPDATE "prisma_contract"."marker" SET "core_hash" = $1, "profile_hash" = $2, ' +
        '"updated_at" = now(), "invariants" = $3::text[] ' +
        'WHERE ("marker"."space" = $4 AND "marker"."core_hash" = $5) RETURNING "marker"."space"',
    );
    // union({a,b}, {b,c}) deduped + sorted — not the incoming set verbatim.
    expect(update.params).toEqual([
      'sha256:to',
      'sha256:prof',
      ['inv-a', 'inv-b', 'inv-c'],
      'app',
      'sha256:from',
    ]);
    expect(matched).toBe(true);
  });

  it('updateMarker omits the invariants assignment when none are supplied', async () => {
    const driver = createCapturingDriver([]);
    const matched = await adapter.updateMarker(driver, 'app', 'sha256:from', {
      storageHash: 'sha256:to',
      profileHash: 'sha256:prof',
    });

    const { sql, params } = driver.calls[0]!;
    expect(sql).toBe(
      'UPDATE "prisma_contract"."marker" SET "core_hash" = $1, "profile_hash" = $2, ' +
        '"updated_at" = now() ' +
        'WHERE ("marker"."space" = $3 AND "marker"."core_hash" = $4) RETURNING "marker"."space"',
    );
    expect(params).toEqual(['sha256:to', 'sha256:prof', 'app', 'sha256:from']);
    expect(matched).toBe(false);
  });

  it('writeLedgerEntry lowers to an INSERT with jsonb operations', async () => {
    const driver = createCapturingDriver();
    await adapter.writeLedgerEntry(driver, 'app', {
      edgeId: 'edge-1',
      from: 'sha256:from',
      to: 'sha256:to',
      migrationName: '001_init',
      migrationHash: 'sha256:mig',
      operations: [{ id: 'op-1' }],
    });

    const { sql, params } = driver.calls[0]!;
    expect(sql).toBe(
      'INSERT INTO "prisma_contract"."ledger" ("space", "migration_name", "migration_hash", ' +
        '"origin_core_hash", "destination_core_hash", "operations") ' +
        'VALUES ($1, $2, $3, $4, $5, $6::jsonb)',
    );
    expect(params.slice(0, 5)).toEqual([
      'app',
      '001_init',
      'sha256:mig',
      'sha256:from',
      'sha256:to',
    ]);
  });
});
