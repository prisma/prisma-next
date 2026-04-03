import type { Contract } from './contract-types';
import type { DomainContractShape, DomainValidationResult } from './validate-domain';
import { validateContractDomain } from './validate-domain';

/**
 * Family-provided storage validator.
 * SQL validates tables/columns/FKs; Mongo validates collections/embedding.
 */
export type StorageValidator = (contract: Contract) => void;

export interface ValidateContractResult {
  readonly warnings: string[];
}

function stripPersistenceFields(raw: Record<string, unknown>): Record<string, unknown> {
  const { schemaVersion: _, sources: _s, ...rest } = raw;
  return rest;
}

function extractDomainShape(contract: Contract): DomainContractShape {
  return {
    roots: contract.roots,
    models: contract.models,
  };
}

/**
 * Framework-level contract validation (ADR 182).
 *
 * Two-pass validation:
 * 1. **Domain validation** (framework-owned): roots, relation targets,
 *    variant/base consistency, discriminators, ownership, orphans.
 * 2. **Storage validation** (family-provided): SQL validates tables/columns/FKs;
 *    Mongo validates collections/embedding.
 *
 * JSON persistence fields (`schemaVersion`, `sources`) are stripped before
 * validation — they are not part of the in-memory contract representation.
 *
 * @template TContract  The fully-typed contract type (preserves literal types).
 * @param value           Raw contract value (e.g. parsed from JSON).
 * @param storageValidator  Family-specific storage validation function.
 * @returns The validated contract with full literal types.
 */
export function validateContract<TContract extends Contract>(
  value: unknown,
  storageValidator: StorageValidator,
): TContract & ValidateContractResult {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Contract must be a non-null object');
  }

  const stripped = stripPersistenceFields(value as Record<string, unknown>);
  const contract = stripped as unknown as Contract;

  const domainResult: DomainValidationResult = validateContractDomain(extractDomainShape(contract));

  storageValidator(contract);

  return Object.assign(contract as unknown as TContract, {
    warnings: domainResult.warnings,
  });
}
