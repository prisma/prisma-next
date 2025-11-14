import { dirname, join } from 'node:path';
import type { TargetFamilyHook } from '@prisma-next/emitter';
import type { OperationSignature } from '@prisma-next/operations';
import { type } from 'arktype';
import type { ExtensionPackManifest, OperationManifest } from './pack-manifest-types';

/**
 * Descriptor for a target family (e.g., SQL).
 * Provides the family hook and assembly helpers.
 */
export interface FamilyDescriptor {
  readonly kind: 'family';
  readonly id: string;
  readonly hook: TargetFamilyHook;
  /**
   * Family-specific verification helpers for DB-connected commands.
   * Must remain in the migration/tooling plane (no runtime imports).
   */
  readonly verify?: {
    /**
     * Returns the SQL statement to read the contract marker.
     * Family implementations should return a parameterized statement.
     */
    readMarkerSql: () => { readonly sql: string; readonly params: readonly unknown[] };
    /**
     * Optionally collects supported codec typeIds from adapter/extension manifests
     * to enable coverage checks.
     */
    collectSupportedCodecTypeIds?: (
      descriptors: ReadonlyArray<TargetDescriptor | AdapterDescriptor | ExtensionDescriptor>,
    ) => readonly string[];
  };
  /**
   * Converts an OperationManifest to an OperationSignature.
   * Family-specific conversion logic (e.g., SQL adds lowering spec).
   */
  readonly convertOperationManifest: (manifest: OperationManifest) => OperationSignature;
  /**
   * Validates a contract JSON and returns a validated ContractIR (without mappings).
   * Mappings are runtime-only and should not be part of ContractIR.
   */
  readonly validateContractIR: (contractJson: unknown) => unknown;
  /**
   * Optionally strips mappings from a contract.
   * Default implementation is a no-op (returns contract as-is).
   * SQL family overrides this to strip mappings before emitting ContractIR.
   */
  readonly stripMappings?: (contract: unknown) => unknown;
}

/**
 * Descriptor for a target pack (e.g., Postgres target).
 */
export interface TargetDescriptor {
  readonly kind: 'target';
  readonly id: string;
  readonly family: string;
  readonly manifest: ExtensionPackManifest;
}

/**
 * Descriptor for an adapter pack (e.g., Postgres adapter).
 * May optionally provide a runtime factory for DB-connected commands.
 */
export interface AdapterDescriptor {
  readonly kind: 'adapter';
  readonly id: string;
  readonly family: string;
  readonly manifest: ExtensionPackManifest;
  readonly create?: (...args: unknown[]) => unknown;
  readonly adapter?: unknown;
}

/**
 * Descriptor for an extension pack (e.g., pgvector).
 */
export interface ExtensionDescriptor {
  readonly kind: 'extension';
  readonly id: string;
  readonly family: string;
  readonly manifest: ExtensionPackManifest;
}

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

