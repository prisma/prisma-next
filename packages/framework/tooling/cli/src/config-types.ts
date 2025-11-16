import { dirname, join } from 'node:path';
import type {
  AdapterDescriptor,
  DriverDescriptor,
  ExtensionDescriptor,
  FamilyDescriptor,
  TargetDescriptor,
  TargetFamilyContext,
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
 * @template TCtx - The target family context type (defaults to TargetFamilyContext for backward compatibility).
 */
export interface PrismaNextConfig<TCtx extends TargetFamilyContext = TargetFamilyContext> {
  readonly family: FamilyDescriptor<TCtx>;
  readonly target: TargetDescriptor<TCtx>;
  readonly adapter: AdapterDescriptor<TCtx>;
  readonly extensions?: ReadonlyArray<ExtensionDescriptor<TCtx>>;
  /**
   * Driver descriptor for DB-connected CLI commands.
   * Required for DB-connected commands (e.g., db verify).
   * Optional for commands that don't need database access (e.g., emit).
   */
  readonly driver?: DriverDescriptor;
  readonly db?: {
    readonly url?: string;
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
 * The function infers the context type from the `family` parameter, so callers don't need to specify it explicitly.
 *
 * @param config - Raw config input from user
 * @returns Normalized config IR with defaults applied
 * @throws Error if config structure is invalid
 */
export function defineConfig<TCtx extends TargetFamilyContext = TargetFamilyContext>(
  config: PrismaNextConfig<TCtx>,
): PrismaNextConfig<TCtx> {
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
