import type { ControlDriverInstance } from '@prisma-next/core-control-plane/types';
import { ensureSchemaStatement } from '@prisma-next/sql-runtime';

/**
 * SQL statement for ensuring the ledger table exists.
 */
export const ensureLedgerTableStatement = {
  sql: `create table if not exists prisma_contract.ledger (
    id bigserial primary key,
    edge_id text not null,
    from_core_hash text not null,
    to_core_hash text not null,
    from_profile_hash text not null,
    to_profile_hash text not null,
    applied_at timestamptz not null default now(),
    mode text not null,
    operation_count int not null,
    summary text
  )`,
  params: [] as readonly unknown[],
};

/**
 * Ensures the prisma_contract schema and ledger table exist.
 */
export async function ensureLedgerTable(driver: ControlDriverInstance<'postgres'>): Promise<void> {
  // Ensure schema exists
  await driver.query(ensureSchemaStatement.sql, ensureSchemaStatement.params);
  // Ensure ledger table exists
  await driver.query(ensureLedgerTableStatement.sql, ensureLedgerTableStatement.params);
}

/**
 * Input for writing a ledger entry.
 */
export interface WriteLedgerEntryInput {
  readonly edgeId: string;
  readonly fromCoreHash: string;
  readonly toCoreHash: string;
  readonly fromProfileHash: string;
  readonly toProfileHash: string;
  readonly mode: 'init' | 'update' | 'migration';
  readonly operationCount: number;
  readonly summary?: string;
}

/**
 * Writes a ledger entry for an applied migration edge.
 */
export async function writeLedgerEntry(
  driver: ControlDriverInstance<'postgres'>,
  input: WriteLedgerEntryInput,
): Promise<void> {
  const sql = `
    INSERT INTO prisma_contract.ledger (
      edge_id,
      from_core_hash,
      to_core_hash,
      from_profile_hash,
      to_profile_hash,
      mode,
      operation_count,
      summary
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  `.trim();

  const params: readonly unknown[] = [
    input.edgeId,
    input.fromCoreHash,
    input.toCoreHash,
    input.fromProfileHash,
    input.toProfileHash,
    input.mode,
    input.operationCount,
    input.summary ?? null,
  ];

  await driver.query(sql, params);
}

/**
 * Generates a deterministic edge ID from from/to hashes.
 * For v1, uses a simple concatenation. Future enhancement: use content-addressed hash per ADR 028.
 */
export function generateEdgeId(fromCoreHash: string, toCoreHash: string): string {
  // For v1: Simple deterministic ID
  // TODO: Enhance to use content-addressed hash per ADR 028
  return `edge_${fromCoreHash.slice(0, 8)}_${toCoreHash.slice(0, 8)}`;
}
