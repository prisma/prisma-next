import { introspectPostgresSchema } from '@prisma-next/adapter-postgres/introspect';
import { assembleCodecRegistry } from '@prisma-next/cli/pack-assembly';
import type { ContractMarkerRecord } from '@prisma-next/contract/types';
import type {
  AdapterDescriptor,
  ControlPlaneDriver,
  ExtensionDescriptor,
  FamilyDescriptor,
  TargetDescriptor,
} from '@prisma-next/core-control-plane/types';
import { verifyDatabaseSchema } from '@prisma-next/core-control-plane/verify-database-schema';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { type } from 'arktype';

const MetaSchema = type({ '[string]': 'unknown' });

function parseMeta(meta: unknown): Record<string, unknown> {
  if (meta === null || meta === undefined) {
    return {};
  }

  let parsed: unknown;
  if (typeof meta === 'string') {
    try {
      parsed = JSON.parse(meta);
    } catch {
      return {};
    }
  } else {
    parsed = meta;
  }

  const result = MetaSchema(parsed);
  if (result instanceof type.errors) {
    return {};
  }

  return result as Record<string, unknown>;
}

const ContractMarkerRowSchema = type({
  core_hash: 'string',
  profile_hash: 'string',
  'contract_json?': 'unknown | null',
  'canonical_version?': 'number | null',
  'updated_at?': 'Date | string',
  'app_tag?': 'string | null',
  'meta?': 'unknown | null',
});

/**
 * Parses a contract marker row from database query result.
 * This is SQL-specific parsing logic (handles SQL row structure with snake_case columns).
 */
export function parseContractMarkerRow(row: unknown): ContractMarkerRecord {
  const result = ContractMarkerRowSchema(row);
  if (result instanceof type.errors) {
    const messages = result.map((p: { message: string }) => p.message).join('; ');
    throw new Error(`Invalid contract marker row: ${messages}`);
  }

  const validatedRow = result as {
    core_hash: string;
    profile_hash: string;
    contract_json?: unknown | null;
    canonical_version?: number | null;
    updated_at?: Date | string;
    app_tag?: string | null;
    meta?: unknown | null;
  };

  const updatedAt = validatedRow.updated_at
    ? validatedRow.updated_at instanceof Date
      ? validatedRow.updated_at
      : new Date(validatedRow.updated_at)
    : new Date();

  return {
    coreHash: validatedRow.core_hash,
    profileHash: validatedRow.profile_hash,
    contractJson: validatedRow.contract_json ?? null,
    canonicalVersion: validatedRow.canonical_version ?? null,
    updatedAt,
    appTag: validatedRow.app_tag ?? null,
    meta: parseMeta(validatedRow.meta),
  };
}

/**
 * Returns the SQL statement to read the contract marker.
 * This is a migration-plane helper (no runtime imports).
 * @internal - Used internally by readMarker(). Prefer readMarker() for Control Plane usage.
 */
export function readMarkerSql(): { readonly sql: string; readonly params: readonly unknown[] } {
  return {
    sql: `select
      core_hash,
      profile_hash,
      contract_json,
      canonical_version,
      updated_at,
      app_tag,
      meta
    from prisma_contract.marker
    where id = $1`,
    params: [1],
  };
}

/**
 * Reads the contract marker from the database using the provided driver.
 * Returns the parsed marker record or null if no marker is found.
 * This abstracts SQL-specific details from the Control Plane.
 *
 * @param driver - ControlPlaneDriver instance for executing queries
 * @returns Promise resolving to ContractMarkerRecord or null if marker not found
 */
export async function readMarker(driver: ControlPlaneDriver): Promise<ContractMarkerRecord | null> {
  const markerStatement = readMarkerSql();
  const queryResult = await driver.query<{
    core_hash: string;
    profile_hash: string;
    contract_json: unknown | null;
    canonical_version: number | null;
    updated_at: Date | string;
    app_tag: string | null;
    meta: unknown | null;
  }>(markerStatement.sql, markerStatement.params);

  if (queryResult.rows.length === 0) {
    return null;
  }

  const markerRow = queryResult.rows[0];
  if (!markerRow) {
    // If rows array has length > 0 but first element is undefined, this is an unexpected result structure
    throw new Error('Database query returned unexpected result structure');
  }

  return parseContractMarkerRow(markerRow);
}

/**
 * Collects supported codec type IDs from adapter and extension manifests.
 * Returns a sorted, unique array of type IDs that are declared in the manifests.
 * This enables coverage checks by comparing contract column types against supported types.
 *
 * Note: This extracts type IDs from manifest type imports, not from runtime codec registries.
 * The manifests declare which codec types are available, but the actual type IDs
 * are defined in the codec-types TypeScript modules that are imported.
 *
 * For MVP, we return an empty array since extracting type IDs from TypeScript modules
 * would require runtime evaluation or static analysis. This can be enhanced later.
 */
export function collectSupportedCodecTypeIds(
  descriptors: ReadonlyArray<TargetDescriptor | AdapterDescriptor | ExtensionDescriptor>,
): readonly string[] {
  // For MVP, return empty array
  // Future enhancement: Extract type IDs from codec-types modules via static analysis
  // or require manifests to explicitly list supported type IDs
  void descriptors;
  return [];
}

/**
 * Introspects the database schema and returns a target-agnostic SqlSchemaIR.
 * Delegates to Postgres adapter for concrete introspection.
 * This is the SQL family's implementation of the introspectSchema hook.
 */
export async function introspectSchema(options: {
  readonly driver: ControlPlaneDriver;
  readonly contractIR?: unknown;
  readonly target: TargetDescriptor;
  readonly adapter: AdapterDescriptor;
  readonly extensions: ReadonlyArray<ExtensionDescriptor>;
}): Promise<SqlSchemaIR> {
  const { driver, contractIR, adapter, extensions } = options;

  // Assemble codec registry from adapter + extensions
  const codecRegistry = await assembleCodecRegistry(adapter, extensions);

  // Delegate to Postgres adapter for concrete introspection
  // For now, we only support Postgres. In the future, this can branch on target.id
  if (options.target.id !== 'postgres') {
    throw new Error(`Schema introspection for target '${options.target.id}' is not yet supported`);
  }

  return introspectPostgresSchema(driver, codecRegistry, contractIR);
}

/**
 * Schema issue types for database schema verification.
 */
type SchemaIssue = {
  readonly kind:
    | 'missing_table'
    | 'missing_column'
    | 'type_mismatch'
    | 'nullability_mismatch'
    | 'primary_key_mismatch'
    | 'foreign_key_mismatch'
    | 'unique_constraint_mismatch'
    | 'index_mismatch'
    | 'extension_missing';
  readonly table: string;
  readonly column?: string;
  readonly indexOrConstraint?: string;
  readonly expected?: string;
  readonly actual?: string;
  readonly message: string;
};

/**
 * Verifies that the live database schema satisfies the emitted contract.
 * Thin wrapper around core verifyDatabaseSchema action.
 * This is used by `db schema-verify` command.
 */
export async function verifySchema(options: {
  readonly driver: ControlPlaneDriver;
  readonly contractIR: unknown;
  readonly family: FamilyDescriptor<SqlSchemaIR>;
  readonly target: TargetDescriptor;
  readonly adapter: AdapterDescriptor;
  readonly extensions: ReadonlyArray<ExtensionDescriptor>;
  readonly strict: boolean;
  readonly startTime: number;
  readonly contractPath: string;
  readonly configPath?: string;
}): Promise<{
  readonly ok: boolean;
  readonly code?: string;
  readonly summary: string;
  readonly contract: {
    readonly coreHash: string;
    readonly profileHash?: string;
  };
  readonly target: {
    readonly expected: string;
    readonly actual?: string;
  };
  readonly schema: {
    readonly issues: ReadonlyArray<SchemaIssue>;
  };
  readonly meta?: {
    readonly configPath?: string;
    readonly contractPath: string;
    readonly strict: boolean;
  };
  readonly timings: {
    readonly total: number;
  };
}> {
  // Delegate to core verifyDatabaseSchema action
  // The family descriptor is passed in from config, avoiding circular dependency
  // (we receive it as a parameter rather than importing sqlFamilyDescriptor)
  return verifyDatabaseSchema({
    driver: options.driver,
    contractIR: options.contractIR,
    family: options.family,
    target: options.target,
    adapter: options.adapter,
    extensions: options.extensions,
    strict: options.strict,
    startTime: options.startTime,
    contractPath: options.contractPath,
    ...(options.configPath ? { configPath: options.configPath } : {}),
  });
}
