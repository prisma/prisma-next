import type { TargetFamilyHook, TypesImportSpec } from '@prisma-next/emitter';
import type { OperationRegistry } from '@prisma-next/operations';
import type { ExtensionPackManifest } from './pack-manifest-types';

/**
 * Descriptor for a target family (e.g., SQL).
 * Provides the family hook and assembly helpers.
 */
export interface FamilyDescriptor {
  readonly kind: 'family';
  readonly id: string;
  readonly hook: TargetFamilyHook;
  readonly assembleOperationRegistry: (
    descriptors: ReadonlyArray<TargetDescriptor | AdapterDescriptor | ExtensionDescriptor>,
  ) => OperationRegistry;
  readonly extractCodecTypeImports: (
    descriptors: ReadonlyArray<TargetDescriptor | AdapterDescriptor | ExtensionDescriptor>,
  ) => ReadonlyArray<TypesImportSpec>;
  readonly extractOperationTypeImports: (
    descriptors: ReadonlyArray<TargetDescriptor | AdapterDescriptor | ExtensionDescriptor>,
  ) => ReadonlyArray<TypesImportSpec>;
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
 * Configuration for Prisma Next CLI.
 */
export interface PrismaNextConfig {
  readonly family: FamilyDescriptor;
  readonly target: TargetDescriptor;
  readonly adapter: AdapterDescriptor;
  readonly extensions?: ReadonlyArray<ExtensionDescriptor>;
  readonly db?: {
    readonly url?: string;
    readonly [key: string]: unknown;
  };
}

/**
 * Helper function to define a Prisma Next config.
 * Provides type checking and validation.
 */
export function defineConfig(config: PrismaNextConfig): PrismaNextConfig {
  return config;
}
