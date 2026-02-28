import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ContractIR } from '@prisma-next/contract/ir';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { type } from 'arktype';
import type {
  ControlAdapterDescriptor,
  ControlDriverDescriptor,
  ControlDriverInstance,
  ControlExtensionDescriptor,
  ControlFamilyDescriptor,
  ControlTargetDescriptor,
} from './types';

/**
 * Type alias for CLI driver instances.
 * Uses string for both family and target IDs for maximum flexibility.
 */
export type CliDriver = ControlDriverInstance<string, string>;

export interface ContractSourceDiagnosticPosition {
  readonly offset: number;
  readonly line: number;
  readonly column: number;
}

export interface ContractSourceDiagnosticSpan {
  readonly start: ContractSourceDiagnosticPosition;
  readonly end: ContractSourceDiagnosticPosition;
}

export interface ContractSourceDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly sourceId?: string;
  readonly span?: ContractSourceDiagnosticSpan;
}

export interface ContractSourceDiagnostics {
  readonly summary: string;
  readonly diagnostics: readonly ContractSourceDiagnostic[];
  readonly meta?: Record<string, unknown>;
}

export type ContractSourceProvider = () => Promise<Result<ContractIR, ContractSourceDiagnostics>>;

export type PrismaContractResolverInput = {
  readonly schema: string;
  readonly schemaPath: string;
  readonly absoluteSchemaPath: string;
};

export type PrismaContractResolver = (
  input: PrismaContractResolverInput,
) =>
  | Result<ContractIR, ContractSourceDiagnostics>
  | Promise<Result<ContractIR, ContractSourceDiagnostics>>;

/**
 * Contract configuration specifying source and artifact locations.
 */
export interface ContractConfig {
  /**
   * Contract source provider. The provider is always async and must return
   * a Result containing either ContractIR or structured diagnostics.
   */
  readonly source: ContractSourceProvider;
  /**
   * Path to contract.json artifact. Defaults to 'src/prisma/contract.json'.
   * The .d.ts types file will be colocated (e.g., contract.json → contract.d.ts).
   */
  readonly output?: string;
}

export function typescriptContract(contractIR: ContractIR, output?: string): ContractConfig {
  return {
    source: async () => ok(contractIR),
    ...(output ? { output } : {}),
  };
}

export function prismaContract(
  schemaPath: string,
  resolver: PrismaContractResolver,
  output?: string,
): ContractConfig {
  return {
    source: async () => {
      const absoluteSchemaPath = resolve(schemaPath);
      let schema: string;
      try {
        schema = await readFile(absoluteSchemaPath, 'utf-8');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return notOk({
          summary: `Failed to read Prisma schema at "${schemaPath}"`,
          diagnostics: [
            {
              code: 'PSL_SCHEMA_READ_FAILED',
              message,
              sourceId: schemaPath,
            },
          ],
          meta: { schemaPath, absoluteSchemaPath, cause: message },
        });
      }
      return await resolver({
        schema,
        schemaPath,
        absoluteSchemaPath,
      });
    },
    ...(output ? { output } : {}),
  };
}

/**
 * Configuration for Prisma Next CLI.
 * Uses Control*Descriptor types for type-safe wiring with compile-time compatibility checks.
 *
 * @template TFamilyId - The family ID (e.g., 'sql', 'document')
 * @template TTargetId - The target ID (e.g., 'postgres', 'mysql')
 * @template TConnection - The driver connection input type (defaults to `unknown` for config flexibility)
 */
export interface PrismaNextConfig<
  TFamilyId extends string = string,
  TTargetId extends string = string,
  TConnection = unknown,
> {
  readonly family: ControlFamilyDescriptor<TFamilyId>;
  readonly target: ControlTargetDescriptor<TFamilyId, TTargetId>;
  readonly adapter: ControlAdapterDescriptor<TFamilyId, TTargetId>;
  readonly extensionPacks?: readonly ControlExtensionDescriptor<TFamilyId, TTargetId>[];
  /**
   * Driver descriptor for DB-connected CLI commands.
   * Required for DB-connected commands (e.g., db verify).
   * Optional for commands that don't need database access (e.g., emit).
   * The driver's connection type matches the TConnection config parameter.
   */
  readonly driver?: ControlDriverDescriptor<
    TFamilyId,
    TTargetId,
    ControlDriverInstance<TFamilyId, TTargetId>,
    TConnection
  >;
  /**
   * Database connection configuration.
   * The connection type is driver-specific (e.g., URL string for Postgres).
   */
  readonly db?: {
    /**
     * Driver-specific connection input.
     * For Postgres: a connection string (URL).
     * For other drivers: may be a structured object.
     */
    readonly connection?: TConnection;
  };
  /**
   * Contract configuration. Specifies source and artifact locations.
   * Required for emit command; optional for other commands that only read artifacts.
   */
  readonly contract?: ContractConfig;
}

/**
 * Arktype schema for ContractConfig validation.
 * Validates that source is present and output/types are strings when provided.
 */
const ContractConfigSchema = type({
  source: 'unknown', // Can be value or function - runtime check needed
  'output?': 'string',
});

/**
 * Arktype schema for PrismaNextConfig validation.
 * Note: This validates structure only. Descriptor objects (family, target, adapter) are validated separately.
 */
const PrismaNextConfigSchema = type({
  family: 'unknown', // ControlFamilyDescriptor - validated separately
  target: 'unknown', // ControlTargetDescriptor - validated separately
  adapter: 'unknown', // ControlAdapterDescriptor - validated separately
  'extensionPacks?': 'unknown[]',
  'driver?': 'unknown', // ControlDriverDescriptor - validated separately (optional)
  'db?': 'unknown',
  'contract?': ContractConfigSchema,
});

/**
 * Helper function to define a Prisma Next config.
 * Validates and normalizes the config using Arktype, then returns the normalized IR.
 *
 * Normalization:
 * - contract.output defaults to 'src/prisma/contract.json' if missing
 *
 * @param config - Raw config input from user
 * @returns Normalized config IR with defaults applied
 * @throws Error if config structure is invalid
 */
export function defineConfig<TFamilyId extends string = string, TTargetId extends string = string>(
  config: PrismaNextConfig<TFamilyId, TTargetId>,
): PrismaNextConfig<TFamilyId, TTargetId> {
  // Validate structure using Arktype
  const validated = PrismaNextConfigSchema(config);
  if (validated instanceof type.errors) {
    const messages = validated.map((p: { message: string }) => p.message).join('; ');
    throw new Error(`Config validation failed: ${messages}`);
  }

  // Normalize contract config if present
  if (config.contract) {
    // Validate contract.source is a provider function (runtime check)
    const source = config.contract.source;
    if (typeof source !== 'function') {
      throw new Error(
        'Config.contract.source must be a provider function returning Promise<Result<ContractIR, Diagnostics>>',
      );
    }

    // Apply defaults
    const output = config.contract.output ?? 'src/prisma/contract.json';

    const normalizedContract: ContractConfig = {
      source: config.contract.source,
      output,
    };

    // Return normalized config
    return {
      ...config,
      contract: normalizedContract,
    };
  }

  // Return config as-is if no contract (preserve literal types)
  return config;
}
