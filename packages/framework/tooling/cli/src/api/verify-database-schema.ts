import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { introspectDatabaseSchema } from '@prisma-next/core-control-plane/introspect-database-schema';
import { verifySchemaAgainstContract } from '@prisma-next/core-control-plane/verify-schema-against-contract';
import { loadConfig } from '../config-loader';
import { assembleCodecRegistry } from '../pack-assembly';
import {
  errorDatabaseUrlRequired,
  errorDriverRequired,
  errorFileNotFound,
  errorUnexpected,
} from '../utils/cli-errors';

export interface VerifyDatabaseSchemaOptions {
  readonly dbUrl?: string;
  readonly configPath?: string;
  readonly strict?: boolean;
}

/**
 * Schema issue kinds that can be reported during schema verification.
 */
export type SchemaIssueKind =
  | 'missing_table'
  | 'missing_column'
  | 'type_mismatch'
  | 'nullability_mismatch'
  | 'primary_key_mismatch'
  | 'foreign_key_mismatch'
  | 'unique_constraint_mismatch'
  | 'index_mismatch'
  | 'extension_missing';

/**
 * A schema issue found during verification.
 */
export interface SchemaIssue {
  readonly kind: SchemaIssueKind;
  readonly table: string;
  readonly column?: string;
  readonly indexOrConstraint?: string;
  readonly expected?: string;
  readonly actual?: string;
  readonly message: string;
}

/**
 * Result type for database schema verification operations.
 * Returned by verifyDatabaseSchema().
 */
export interface VerifyDatabaseSchemaResult {
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
    readonly issues: readonly SchemaIssue[];
  };
  readonly meta?: {
    readonly configPath?: string;
    readonly contractPath: string;
    readonly strict: boolean;
  };
  readonly timings: {
    readonly total: number;
  };
}

/**
 * Programmatic API for verifying database schema against emitted contract.
 * Loads config and contract, uses query runner to introspect schema, and compares against contract.
 *
 * @param options - Options for database schema verification
 * @returns Result with verification status, schema issues, meta, and timings
 * @throws Error if config/contract loading or database connection fails
 */
export async function verifyDatabaseSchema(
  options: VerifyDatabaseSchemaOptions = {},
): Promise<VerifyDatabaseSchemaResult> {
  const startTime = Date.now();

  try {
    // Load config
    const config = await loadConfig(options.configPath);
    const configPath = options.configPath;

    // Resolve database URL
    const dbUrl = options.dbUrl ?? config.db?.url;
    if (!dbUrl) {
      throw errorDatabaseUrlRequired({
        why: 'Database URL is required for db schema-verify',
      });
    }

    // Obtain driver: driver is required
    if (!config.driver) {
      throw errorDriverRequired();
    }
    const driver = await config.driver.create(dbUrl);

    try {
      // Load contract from emitted artifacts
      // Resolve contract path relative to current working directory (project root)
      const contractPath = config.contract?.output ?? 'src/prisma/contract.json';
      const contractJsonPath = resolve(contractPath);
      let contractJsonContent: string;
      try {
        contractJsonContent = await readFile(contractJsonPath, 'utf-8');
      } catch (error) {
        if (error instanceof Error && (error as { code?: string }).code === 'ENOENT') {
          throw errorFileNotFound(contractJsonPath, {
            why: `Contract file not found at ${contractJsonPath}`,
          });
        }
        throw errorUnexpected(error instanceof Error ? error.message : String(error), {
          why: `Failed to read contract file: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
      const contractJson = JSON.parse(contractJsonContent) as Record<string, unknown>;

      // Validate contract using family validator
      const contractIR = config.family.validateContractIR(contractJson);

      // Type guard to ensure contract has required properties
      if (
        typeof contractIR !== 'object' ||
        contractIR === null ||
        !('coreHash' in contractIR) ||
        !('target' in contractIR) ||
        typeof contractIR.coreHash !== 'string' ||
        typeof contractIR.target !== 'string'
      ) {
        throw errorUnexpected('Invalid contract structure', {
          why: 'Contract is missing required fields: coreHash or target',
          fix: 'Re-emit the contract using `prisma-next contract emit`',
        });
      }

      // Extract contract hashes
      const contractCoreHash = contractIR.coreHash;
      const contractProfileHash =
        'profileHash' in contractIR && typeof contractIR.profileHash === 'string'
          ? contractIR.profileHash
          : undefined;

      // Assemble codec registry from adapter + extensions
      const codecRegistry = await assembleCodecRegistry(config.adapter, config.extensions ?? []);

      // 1) Introspect database schema
      // Type safety: config.family is FamilyDescriptor<TSchemaIR>, domain actions are generic
      const { schemaIR } = await introspectDatabaseSchema({
        driver,
        family: config.family,
        target: config.target,
        adapter: config.adapter,
        extensions: config.extensions ?? [],
        codecRegistry,
      });

      // 2) Verify schema against contract
      const { issues } = await verifySchemaAgainstContract({
        contractIR,
        schemaIR,
        family: config.family,
        target: config.target,
        adapter: config.adapter,
        extensions: config.extensions ?? [],
        driver,
        strict: options.strict ?? false,
      });

      // Build result
      const ok = issues.length === 0;
      const code = ok ? undefined : 'PN-SCHEMA-0001';
      const summary = ok
        ? 'Database schema matches contract'
        : `Contract requirements not met: ${issues.length} issue${issues.length === 1 ? '' : 's'} found`;

      return {
        ok,
        ...(code ? { code } : {}),
        summary,
        contract: {
          coreHash: contractCoreHash,
          ...(contractProfileHash ? { profileHash: contractProfileHash } : {}),
        },
        target: {
          expected: config.target.id,
          actual: config.target.id,
        },
        schema: { issues },
        meta: {
          ...(configPath ? { configPath } : {}),
          contractPath: contractJsonPath,
          strict: options.strict ?? false,
        },
        timings: {
          total: Date.now() - startTime,
        },
      };
    } finally {
      // Ensure driver connection is closed
      await driver.close();
    }
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Failed to verify database schema: ${String(error)}`);
  }
}
