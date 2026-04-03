import { type } from 'arktype';
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

const ContractSchema = type({
  target: 'string',
  targetFamily: 'string',
  roots: 'Record<string, string>',
  models: 'Record<string, unknown>',
  storage: 'Record<string, unknown>',
  capabilities: 'Record<string, Record<string, boolean>>',
  extensionPacks: 'Record<string, unknown>',
  meta: 'Record<string, unknown>',
  'execution?': {
    executionHash: 'string',
    mutations: {
      defaults: 'unknown[]',
    },
  },
  'profileHash?': 'string',
});

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
 * Three-pass validation:
 * 1. **Structural validation** (arktype): verifies required fields exist with
 *    correct base types.
 * 2. **Domain validation** (framework-owned): roots, relation targets,
 *    variant/base consistency, discriminators, ownership, orphans.
 * 3. **Storage validation** (family-provided): SQL validates tables/columns/FKs;
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

  const parsed = ContractSchema(stripped);
  if (parsed instanceof type.errors) {
    throw new Error(`Invalid contract structure: ${parsed.summary}`);
  }

  // Arktype verified the structural shape; Contract adds branded hash types and
  // ContractModel generics that can't be expressed in the schema.
  const contract = parsed as unknown as Contract;

  const domainResult: DomainValidationResult = validateContractDomain(extractDomainShape(contract));

  storageValidator(contract);

  // TContract narrows Contract with literal types from the caller's contract.d.ts;
  // the runtime object is the same — the cast preserves the caller's type parameter.
  return Object.assign(contract as unknown as TContract, {
    warnings: domainResult.warnings,
  });
}
