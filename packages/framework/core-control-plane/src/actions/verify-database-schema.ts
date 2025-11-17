import { errorUnexpected } from '../errors';
import type {
  AdapterDescriptor,
  ControlPlaneDriver,
  ExtensionDescriptor,
  FamilyDescriptor,
  SchemaIssue,
  TargetDescriptor,
  TargetFamilyContext,
} from '../types';
import { introspectDatabaseSchema } from './introspect-database-schema';
import { verifySchemaAgainstContract } from './verify-schema-against-contract';

export interface VerifyDatabaseSchemaOptions<
  TCtx extends TargetFamilyContext = TargetFamilyContext,
> {
  readonly driver: ControlPlaneDriver;
  readonly contractIR: unknown;
  readonly family: FamilyDescriptor<TCtx>;
  readonly target: TargetDescriptor<TCtx>;
  readonly adapter: AdapterDescriptor<TCtx>;
  readonly extensions: ReadonlyArray<ExtensionDescriptor<TCtx>>;
  readonly contextInput: TCtx;
  readonly strict: boolean;
  readonly startTime: number;
  readonly contractPath: string;
  readonly configPath?: string;
}

// Re-export SchemaIssue from types for backward compatibility
export type { SchemaIssue } from '../types';

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
 * This orchestrates the two domain actions:
 * 1. Introspects database schema via introspectDatabaseSchema
 * 2. Verifies schema against contract via verifySchemaAgainstContract
 *
 * @param options - Options for database schema verification
 * @returns Result with verification status, schema issues, meta, and timings
 * @throws Error if database connection fails or verification fails
 */
export async function verifyDatabaseSchema<TCtx extends TargetFamilyContext = TargetFamilyContext>(
  options: VerifyDatabaseSchemaOptions<TCtx>,
): Promise<VerifyDatabaseSchemaResult> {
  try {
    const {
      driver,
      contractIR,
      family,
      target,
      adapter,
      extensions,
      contextInput,
      strict,
      startTime,
      contractPath,
      configPath,
    } = options;

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
      });
    }

    // Extract contract hashes
    const contractCoreHash = contractIR.coreHash;
    const contractProfileHash =
      'profileHash' in contractIR && typeof contractIR.profileHash === 'string'
        ? contractIR.profileHash
        : undefined;

    // 1) Introspect database schema
    const { schemaIR } = await introspectDatabaseSchema<TCtx>({
      driver,
      family,
      target,
      adapter,
      extensions,
      contextInput,
    });

    // 2) Verify schema against contract
    const { issues } = await verifySchemaAgainstContract<TCtx>({
      contractIR,
      schemaIR,
      family,
      target,
      adapter,
      extensions,
      driver,
      strict,
    });

    // Calculate timings
    const totalTime = Date.now() - startTime;

    // Determine result
    const ok = issues.length === 0;
    const summary = ok
      ? 'Database schema matches contract'
      : `Contract requirements not met: ${issues.length} issue${issues.length === 1 ? '' : 's'} found`;

    return {
      ok,
      ...(ok ? {} : { code: 'PN-SCHEMA-0001' }),
      summary,
      contract: {
        coreHash: contractCoreHash,
        ...(contractProfileHash ? { profileHash: contractProfileHash } : {}),
      },
      target: {
        expected: target.id,
      },
      schema: {
        issues,
      },
      meta: {
        ...(configPath ? { configPath } : {}),
        contractPath,
        strict,
      },
      timings: {
        total: totalTime,
      },
    };
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Failed to verify database schema: ${String(error)}`);
  }
}
