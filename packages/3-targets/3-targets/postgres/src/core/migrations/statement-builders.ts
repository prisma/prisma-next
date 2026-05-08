import { APP_SPACE_ID } from '@prisma-next/framework-components/control';

export { APP_SPACE_ID };

export interface SqlStatement {
  readonly sql: string;
  readonly params: readonly unknown[];
}

export const ensurePrismaContractSchemaStatement: SqlStatement = {
  sql: 'create schema if not exists prisma_contract',
  params: [],
};

/**
 * Schema for `prisma_contract.marker` after the contract-spaces migration:
 * the single-row `id smallint` key is replaced with a `space text` primary
 * key, allowing one row per loaded contract space (`'app'`,
 * `'<extension-id>'`, …). On a brand-new database `CREATE TABLE IF NOT
 * EXISTS` produces this shape directly; on an upgrading database
 * `migrateMarkerSchemaStatements` below promotes the legacy single-row
 * shape idempotently.
 */
export const ensureMarkerTableStatement: SqlStatement = {
  sql: `create table if not exists prisma_contract.marker (
    space text not null primary key default '${APP_SPACE_ID}',
    core_hash text not null,
    profile_hash text not null,
    contract_json jsonb,
    canonical_version int,
    updated_at timestamptz not null default now(),
    app_tag text,
    meta jsonb not null default '{}',
    invariants text[] not null default '{}'
  )`,
  params: [],
};

/**
 * Idempotent migration that promotes a legacy single-row marker table to
 * the per-space shape defined by `ensureMarkerTableStatement`.
 *
 * Designed to be applied unconditionally on every framework boot
 * (mechanism (A) in `specs/framework-mechanism.spec.md § 2`):
 *
 * - On a fresh database (table just created in the new shape) every
 *   statement is a no-op.
 * - On an already-migrated database (boot N+1) every statement is a
 *   no-op.
 * - On a legacy single-row database (`id smallint primary key default 1`)
 *   the sequence (a) adds the `space` column with `'app'` as the
 *   per-row default, (b) repoints the primary key from `id` to `space`,
 *   (c) drops the obsolete `id` column.
 *
 * Concurrency: each ALTER TABLE acquires Postgres' transactional DDL
 * lock on `prisma_contract.marker`, so concurrent framework boots
 * serialize on the table lock.
 */
export const migrateMarkerSchemaStatements: readonly SqlStatement[] = [
  {
    sql: `alter table prisma_contract.marker
      add column if not exists space text`,
    params: [],
  },
  {
    sql: `update prisma_contract.marker
      set space = '${APP_SPACE_ID}'
      where space is null`,
    params: [],
  },
  {
    sql: `alter table prisma_contract.marker
      alter column space set not null`,
    params: [],
  },
  {
    sql: `alter table prisma_contract.marker
      alter column space set default '${APP_SPACE_ID}'`,
    params: [],
  },
  // Repoint the primary key to (space) when the table is still keyed by
  // legacy `id`. `pg_constraint.conkey` is an array of column attnums;
  // we compare it to the attnum of `space` to decide whether the swap is
  // already done. The DO block keeps the operation idempotent without
  // needing CASE-by-CASE logic in TypeScript.
  {
    sql: `do $$
      declare
        space_attnum smallint;
        space_only_pk boolean;
      begin
        select attnum into space_attnum
        from pg_attribute
        where attrelid = 'prisma_contract.marker'::regclass
          and attname = 'space'
          and not attisdropped;

        if space_attnum is null then
          return; -- column not present yet; earlier statements are responsible.
        end if;

        select coalesce(
          (
            select c.conkey = array[space_attnum]::int2[]
            from pg_constraint c
            where c.conrelid = 'prisma_contract.marker'::regclass
              and c.contype = 'p'
          ),
          false
        ) into space_only_pk;

        if not space_only_pk then
          alter table prisma_contract.marker
            drop constraint if exists marker_pkey;
          alter table prisma_contract.marker
            add constraint marker_pkey primary key (space);
        end if;
      end$$;`,
    params: [],
  },
  {
    sql: `alter table prisma_contract.marker
      drop column if exists id`,
    params: [],
  },
];

export const ensureLedgerTableStatement: SqlStatement = {
  sql: `create table if not exists prisma_contract.ledger (
    id bigserial primary key,
    created_at timestamptz not null default now(),
    origin_core_hash text,
    origin_profile_hash text,
    destination_core_hash text not null,
    destination_profile_hash text,
    contract_json_before jsonb,
    contract_json_after jsonb,
    operations jsonb not null
  )`,
  params: [],
};

export interface MergeMarkerInput {
  /**
   * Logical space identifier for this marker row. Defaults to
   * {@link APP_SPACE_ID} (`'app'`) so existing single-app callers keep
   * working without modification; per-space callers (planner / runner /
   * verifier extensions over contract spaces) pass their space id
   * explicitly.
   */
  readonly space?: string;
  readonly storageHash: string;
  readonly profileHash: string;
  readonly contractJson?: unknown;
  readonly canonicalVersion?: number | null;
  readonly appTag?: string | null;
  readonly meta?: Record<string, unknown>;
  /**
   * Invariants to merge into `marker.invariants`. INSERT writes them as
   * the initial value (callers are expected to pass a sorted, deduped
   * array). UPDATE merges them with the existing column server-side via
   * a single atomic SQL expression.
   */
  readonly invariants: readonly string[];
}

export function buildMergeMarkerStatements(input: MergeMarkerInput): {
  readonly insert: SqlStatement;
  readonly update: SqlStatement;
} {
  const params: readonly unknown[] = [
    input.space ?? APP_SPACE_ID,
    input.storageHash,
    input.profileHash,
    jsonParam(input.contractJson),
    input.canonicalVersion ?? null,
    input.appTag ?? null,
    jsonParam(input.meta ?? {}),
    input.invariants,
  ];

  return {
    insert: {
      sql: `insert into prisma_contract.marker (
        space,
        core_hash,
        profile_hash,
        contract_json,
        canonical_version,
        updated_at,
        app_tag,
        meta,
        invariants
      ) values (
        $1,
        $2,
        $3,
        $4::jsonb,
        $5,
        now(),
        $6,
        $7::jsonb,
        $8::text[]
      )`,
      params,
    },
    update: {
      // `invariants = array(select distinct unnest(invariants || $8::text[]) order by 1)`
      // reads the current column value under the UPDATE's row lock, unions
      // with the incoming array, dedupes, and sorts ascending — single
      // statement, atomic, no read-then-write window.
      sql: `update prisma_contract.marker set
        core_hash = $2,
        profile_hash = $3,
        contract_json = $4::jsonb,
        canonical_version = $5,
        updated_at = now(),
        app_tag = $6,
        meta = $7::jsonb,
        invariants = array(select distinct unnest(invariants || $8::text[]) order by 1)
      where space = $1`,
      params,
    },
  };
}

export interface LedgerInsertInput {
  readonly originStorageHash?: string | null;
  readonly originProfileHash?: string | null;
  readonly destinationStorageHash: string;
  readonly destinationProfileHash?: string | null;
  readonly contractJsonBefore?: unknown;
  readonly contractJsonAfter?: unknown;
  readonly operations: unknown;
}

export function buildLedgerInsertStatement(input: LedgerInsertInput): SqlStatement {
  return {
    sql: `insert into prisma_contract.ledger (
      origin_core_hash,
      origin_profile_hash,
      destination_core_hash,
      destination_profile_hash,
      contract_json_before,
      contract_json_after,
      operations
    ) values (
      $1,
      $2,
      $3,
      $4,
      $5::jsonb,
      $6::jsonb,
      $7::jsonb
    )`,
    params: [
      input.originStorageHash ?? null,
      input.originProfileHash ?? null,
      input.destinationStorageHash,
      input.destinationProfileHash ?? null,
      jsonParam(input.contractJsonBefore),
      jsonParam(input.contractJsonAfter),
      jsonParam(input.operations),
    ],
  };
}

function jsonParam(value: unknown): string {
  return JSON.stringify(value ?? null);
}
