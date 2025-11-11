import { irHeader, irMeta } from '../src/factories';
import type { ContractIR } from '../src/types';

/**
 * Factory function for creating ContractIR objects in tests.
 * Provides sensible defaults and allows overriding specific fields.
 * Uses the emitter factories internally for consistency.
 *
 * If a field is explicitly set to `undefined` in overrides, it will be omitted
 * from the result (useful for testing validation of missing fields).
 */
export function createContractIR(
  overrides: Partial<ContractIR> & { coreHash?: string; profileHash?: string } = {},
): ContractIR {
  // Check if fields are explicitly undefined (not just missing)
  const hasTarget = 'target' in overrides;
  const hasTargetFamily = 'targetFamily' in overrides;
  const hasCoreHash = 'coreHash' in overrides;
  const hasSchemaVersion = 'schemaVersion' in overrides;
  const hasModels = 'models' in overrides;
  const hasRelations = 'relations' in overrides;
  const hasStorage = 'storage' in overrides;
  const hasCapabilities = 'capabilities' in overrides;
  const hasExtensions = 'extensions' in overrides;
  const hasMeta = 'meta' in overrides;
  const hasSources = 'sources' in overrides;

  // Build header, omitting fields that are explicitly undefined
  const headerOpts: {
    target?: string;
    targetFamily?: string;
    coreHash?: string;
    profileHash?: string;
  } = {};

  if (hasTarget && overrides.target !== undefined) {
    headerOpts.target = overrides.target;
  } else if (!hasTarget) {
    headerOpts.target = 'postgres';
  }

  if (hasTargetFamily && overrides.targetFamily !== undefined) {
    headerOpts.targetFamily = overrides.targetFamily;
  } else if (!hasTargetFamily) {
    headerOpts.targetFamily = 'sql';
  }

  if (hasCoreHash && overrides.coreHash !== undefined) {
    headerOpts.coreHash = overrides.coreHash;
  } else if (!hasCoreHash) {
    headerOpts.coreHash = 'sha256:test';
  }

  // profileHash is not part of ContractIR, but we can accept it for header creation
  if (overrides.profileHash !== undefined) {
    headerOpts.profileHash = overrides.profileHash;
  }

  const header = irHeader(
    headerOpts as {
      target: string;
      targetFamily: string;
      coreHash: string;
      profileHash?: string;
    },
  );

  // Build meta, handling explicitly undefined fields
  // If a field is explicitly undefined, we'll omit it from the result later
  const metaOpts: {
    capabilities?: Record<string, Record<string, boolean>>;
    extensions?: Record<string, unknown>;
    meta?: Record<string, unknown>;
    sources?: Record<string, unknown>;
  } = {};

  if (hasCapabilities && overrides.capabilities !== undefined) {
    metaOpts.capabilities = overrides.capabilities;
  } else if (!hasCapabilities) {
    metaOpts.capabilities = {};
  }

  if (hasExtensions && overrides.extensions !== undefined) {
    metaOpts.extensions = overrides.extensions;
  } else if (!hasExtensions) {
    metaOpts.extensions = {};
  }

  if (hasMeta && overrides.meta !== undefined) {
    metaOpts.meta = overrides.meta;
  } else if (!hasMeta) {
    metaOpts.meta = {};
  }

  if (hasSources && overrides.sources !== undefined) {
    metaOpts.sources = overrides.sources;
  } else if (!hasSources) {
    metaOpts.sources = {};
  }

  const meta = irMeta(Object.keys(metaOpts).length > 0 ? metaOpts : undefined);

  // Build result by constructing the object directly (ContractIR doesn't include coreHash/profileHash)
  // When fields are explicitly undefined, include them as undefined (tests use type assertions to bypass TS)
  const result = {
    schemaVersion:
      hasSchemaVersion && overrides.schemaVersion !== undefined
        ? overrides.schemaVersion
        : hasSchemaVersion && overrides.schemaVersion === undefined
          ? (undefined as unknown as string)
          : header.schemaVersion,
    target: header.target,
    targetFamily: header.targetFamily,
    // Only include meta fields if they're not explicitly undefined
    capabilities:
      hasCapabilities && overrides.capabilities === undefined
        ? (undefined as unknown as Record<string, Record<string, boolean>>)
        : !hasCapabilities || overrides.capabilities !== undefined
          ? meta.capabilities
          : ({} as Record<string, Record<string, boolean>>),
    extensions:
      hasExtensions && overrides.extensions === undefined
        ? (undefined as unknown as Record<string, unknown>)
        : !hasExtensions || overrides.extensions !== undefined
          ? meta.extensions
          : ({} as Record<string, unknown>),
    meta:
      hasMeta && overrides.meta === undefined
        ? (undefined as unknown as Record<string, unknown>)
        : !hasMeta || overrides.meta !== undefined
          ? meta.meta
          : ({} as Record<string, unknown>),
    sources:
      hasSources && overrides.sources === undefined
        ? (undefined as unknown as Record<string, unknown>)
        : !hasSources || overrides.sources !== undefined
          ? meta.sources
          : ({} as Record<string, unknown>),
    // Only include family sections if they're not explicitly undefined
    storage:
      hasStorage && overrides.storage === undefined
        ? (undefined as unknown as Record<string, unknown>)
        : hasStorage && overrides.storage !== undefined
          ? (overrides.storage as Record<string, unknown>)
          : !hasStorage
            ? ({ tables: {} } as Record<string, unknown>)
            : ({} as Record<string, unknown>),
    models:
      hasModels && overrides.models === undefined
        ? (undefined as unknown as Record<string, unknown>)
        : hasModels && overrides.models !== undefined
          ? (overrides.models as Record<string, unknown>)
          : !hasModels
            ? {}
            : ({} as Record<string, unknown>),
    relations:
      hasRelations && overrides.relations === undefined
        ? (undefined as unknown as Record<string, unknown>)
        : hasRelations && overrides.relations !== undefined
          ? (overrides.relations as Record<string, unknown>)
          : !hasRelations
            ? {}
            : ({} as Record<string, unknown>),
  } as ContractIR;

  return result;
}
