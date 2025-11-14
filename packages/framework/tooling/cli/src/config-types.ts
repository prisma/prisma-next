import { dirname, join } from 'node:path';
import type {
  AdapterDescriptor,
  DriverDescriptor,
  ExtensionDescriptor,
  FamilyDescriptor,
  TargetDescriptor,
} from '@prisma-next/core-control-plane/types';
import { type } from 'arktype';

// Re-export core-control-plane descriptor types
export type {
  AdapterDescriptor,
  DriverDescriptor,
  ExtensionDescriptor,
  FamilyDescriptor,
  TargetDescriptor,
} from '@prisma-next/core-control-plane/types';

// Descriptor types are re-exported from core-control-plane above

/**
 * Contract configuration specifying source and artifact locations.
 */
export interface ContractConfig {
  /**
   * Contract source. Can be a value or a function that returns a value (sync or async).
   * If a function, it will be called to resolve the contract.
   */
  readonly source: unknown | (() => unknown | Promise<unknown>);
  /**
   * Path to contract.json artifact. Defaults to 'src/prisma/contract.json'.
   * This is the canonical location where other CLI commands can find the contract JSON.
   */
  readonly output?: string;
  /**
   * Path to contract.d.ts artifact. Defaults to output with .d.ts extension.
   * If output ends with .json, replaces .json with .d.ts.
   * Otherwise, appends .d.ts to the directory containing output.
   */
  readonly types?: string;
}

/**
 * Configuration for Prisma Next CLI.
 */
export interface PrismaNextConfig {
  readonly family: FamilyDescriptor;
  readonly target: TargetDescriptor;
  readonly adapter: AdapterDescriptor;
  readonly extensions?: ReadonlyArray<ExtensionDescriptor>;
  /**
   * Driver descriptor for DB-connected CLI commands.
   * Required for DB-connected commands (e.g., db verify).
   * Optional for commands that don't need database access (e.g., emit).
   */
  readonly driver?: DriverDescriptor;
  readonly db?: {
    readonly url?: string;
    /**
     * Family-agnostic minimal query runner factory for DB-connected CLI commands.
     * The CLI will call this to obtain a runner with a single query method.
     * Can be async to support dynamic imports in ESM contexts.
     */
    readonly queryRunnerFactory?: (url: string) =>
      | {
          readonly query: <Row = Record<string, unknown>>(
            sql: string,
            params?: readonly unknown[],
          ) => Promise<{ readonly rows: Row[] }>;
          readonly close?: () => Promise<void>;
        }
      | Promise<{
          readonly query: <Row = Record<string, unknown>>(
            sql: string,
            params?: readonly unknown[],
          ) => Promise<{ readonly rows: Row[] }>;
          readonly close?: () => Promise<void>;
        }>;
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
  'types?': 'string',
});

/**
 * Arktype schema for PrismaNextConfig validation.
 * Note: This validates structure only. Descriptor objects (family, target, adapter) are validated separately.
 */
const PrismaNextConfigSchema = type({
  family: 'unknown', // FamilyDescriptor - validated separately
  target: 'unknown', // TargetDescriptor - validated separately
  adapter: 'unknown', // AdapterDescriptor - validated separately
  'extensions?': 'unknown[]',
  'driver?': 'unknown', // DriverDescriptor - validated separately (optional)
  'db?': 'unknown',
  'contract?': ContractConfigSchema,
});

/**
 * Helper function to define a Prisma Next config.
 * Validates and normalizes the config using Arktype, then returns the normalized IR.
 *
 * Normalization:
 * - contract.output defaults to 'src/prisma/contract.json' if missing
 * - contract.types defaults to output with .d.ts extension if missing
 *
 * @param config - Raw config input from user
 * @returns Normalized config IR with defaults applied
 * @throws Error if config structure is invalid
 */
export function defineConfig(config: PrismaNextConfig): PrismaNextConfig {
  // Validate structure using Arktype
  const validated = PrismaNextConfigSchema(config);
  if (validated instanceof type.errors) {
    const messages = validated.map((p: { message: string }) => p.message).join('; ');
    throw new Error(`Config validation failed: ${messages}`);
  }

  // Normalize contract config if present
  if (config.contract) {
    // Validate contract.source is a value or function (runtime check)
    const source = config.contract.source;
    if (
      source !== null &&
      typeof source !== 'object' &&
      typeof source !== 'function' &&
      typeof source !== 'string' &&
      typeof source !== 'number' &&
      typeof source !== 'boolean'
    ) {
      throw new Error(
        'Config.contract.source must be a value (object, string, number, boolean, null) or a function',
      );
    }

    // Apply defaults
    const output = config.contract.output ?? 'src/prisma/contract.json';
    const types =
      config.contract.types ??
      (output.endsWith('.json')
        ? `${output.slice(0, -5)}.d.ts`
        : join(dirname(output), 'contract.d.ts'));

    const normalizedContract: ContractConfig = {
      source: config.contract.source,
      output,
      types,
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
