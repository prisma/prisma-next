import { dirname, join } from 'node:path';
import { type } from 'arktype';
import type {
  AdapterDescriptor,
  ControlAdapterDescriptor,
  ControlDriverDescriptor,
  ControlExtensionDescriptor,
  ControlFamilyDescriptor,
  ControlPlaneDriver,
  ControlTargetDescriptor,
  DriverDescriptor,
  ExtensionDescriptor,
  FamilyDescriptor,
  TargetDescriptor,
} from './types';

/**
 * @deprecated Use ControlPlaneDriver from @prisma-next/core-control-plane/types instead
 */
export type CliDriver = ControlPlaneDriver;

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
 * Supports both legacy descriptor types and new Control*Descriptor types for backward compatibility.
 * When using Control*Descriptor types, type-level compatibility is enforced (mismatched familyId/targetId combinations fail at compile time).
 *
 * @template TFamilyId - The family ID (e.g., 'sql', 'document')
 * @template TTargetId - The target ID (e.g., 'postgres', 'mysql'). Only used when Control*Descriptor types are used.
 */
export interface PrismaNextConfig<
  TFamilyId extends string = string,
  TTargetId extends string = string,
> {
  // Support both legacy and new descriptor types
  readonly family: FamilyDescriptor<TFamilyId> | ControlFamilyDescriptor<TFamilyId>;
  readonly target: TargetDescriptor<TFamilyId> | ControlTargetDescriptor<TFamilyId, TTargetId>;
  readonly adapter: AdapterDescriptor<TFamilyId> | ControlAdapterDescriptor<TFamilyId, TTargetId>;
  readonly extensions?:
    | ReadonlyArray<ExtensionDescriptor<TFamilyId>>
    | readonly ControlExtensionDescriptor<TFamilyId, TTargetId>[];
  /**
   * Driver descriptor for DB-connected CLI commands.
   * Required for DB-connected commands (e.g., db verify).
   * Optional for commands that don't need database access (e.g., emit).
   */
  readonly driver?: DriverDescriptor | ControlDriverDescriptor<TFamilyId, TTargetId>;
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
