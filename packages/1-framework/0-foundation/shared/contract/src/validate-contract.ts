import { type } from 'arktype';
import type { Contract } from './contract-types';
import type { DomainContractShape } from './validate-domain';
import { validateContractDomain } from './validate-domain';

export type ContractValidationPhase = 'structural' | 'domain' | 'storage';

export class ContractValidationError extends Error {
  readonly code = 'CONTRACT.VALIDATION_FAILED';
  readonly phase: ContractValidationPhase;

  constructor(message: string, phase: ContractValidationPhase) {
    super(message);
    this.name = 'ContractValidationError';
    this.phase = phase;
  }
}

/**
 * Family-provided storage validator.
 * SQL validates tables/columns/FKs; Mongo validates collections/embedding.
 */
export type StorageValidator = (contract: Contract) => void;

const ContractSchema = type({
  target: 'string',
  targetFamily: 'string',
  'roots?': 'Record<string, string>',
  models: 'Record<string, unknown>',
  storage: 'Record<string, unknown>',
  'capabilities?': 'Record<string, Record<string, boolean>>',
  'extensionPacks?': 'Record<string, unknown>',
  'meta?': 'Record<string, unknown>',
  'execution?': {
    'executionHash?': 'string',
    mutations: {
      defaults: 'unknown[]',
    },
  },
  'profileHash?': 'string',
});

function stripPersistenceFields(raw: Record<string, unknown>): Record<string, unknown> {
  const { schemaVersion: _, sources: _s, _generated: _g, ...rest } = raw;
  return rest;
}

function applyDefaults(contract: Record<string, unknown>): Record<string, unknown> {
  return {
    roots: {},
    capabilities: {},
    extensionPacks: {},
    meta: {},
    ...contract,
  };
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
 * JSON persistence fields (`schemaVersion`, `sources`, `_generated`) are
 * stripped before validation — they are not part of the in-memory contract
 * representation.
 *
 * @template TContract  The fully-typed contract type (preserves literal types).
 * @param value           Raw contract value (e.g. parsed from JSON).
 * @param storageValidator  Family-specific storage validation function.
 * @returns The validated contract with full literal types.
 */
export function validateContract<TContract extends Contract>(
  value: unknown,
  storageValidator: StorageValidator,
): TContract {
  if (typeof value !== 'object' || value === null) {
    throw new ContractValidationError('Contract must be a non-null object', 'structural');
  }

  const stripped = stripPersistenceFields(value as Record<string, unknown>);

  const parsed = ContractSchema(stripped);
  if (parsed instanceof type.errors) {
    throw new ContractValidationError(
      `Invalid contract structure: ${parsed.summary}`,
      'structural',
    );
  }

  const contract = applyDefaults(parsed as Record<string, unknown>) as unknown as Contract;

  validateContractDomain(extractDomainShape(contract));

  storageValidator(contract);

  return contract as unknown as TContract;
}
