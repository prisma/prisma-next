import type { FamilyDescriptor } from '@prisma-next/cli/config-types';
import type { OperationManifest } from '@prisma-next/core-control-plane/pack-manifest-types';
import type { OperationSignature } from '@prisma-next/operations';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { sqlTargetFamilyHook } from '@prisma-next/sql-contract-emitter';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import type { SqlOperationSignature } from '@prisma-next/sql-operations';
import { collectSupportedCodecTypeIds, readMarker, verifySchema } from './verify';

/**
 * Converts an OperationManifest (from ExtensionPackManifest) to a SqlOperationSignature.
 */
function operationManifestToSignature(manifest: OperationManifest): SqlOperationSignature {
  return {
    forTypeId: manifest.for,
    method: manifest.method,
    args: manifest.args.map((arg: OperationManifest['args'][number]) => {
      if (arg.kind === 'typeId') {
        if (!arg.type) {
          throw new Error('typeId arg must have type property');
        }
        return { kind: 'typeId' as const, type: arg.type };
      }
      if (arg.kind === 'param') {
        return { kind: 'param' as const };
      }
      if (arg.kind === 'literal') {
        return { kind: 'literal' as const };
      }
      throw new Error(`Invalid arg kind: ${(arg as { kind: unknown }).kind}`);
    }),
    returns: (() => {
      if (manifest.returns.kind === 'typeId') {
        return { kind: 'typeId' as const, type: manifest.returns.type };
      }
      if (manifest.returns.kind === 'builtin') {
        return {
          kind: 'builtin' as const,
          type: manifest.returns.type as 'number' | 'boolean' | 'string',
        };
      }
      throw new Error(`Invalid return kind: ${(manifest.returns as { kind: unknown }).kind}`);
    })(),
    lowering: {
      targetFamily: 'sql',
      strategy: manifest.lowering.strategy,
      template: manifest.lowering.template,
    },
    ...(manifest.capabilities ? { capabilities: manifest.capabilities } : {}),
  };
}

/**
 * SQL family descriptor for CLI config.
 * Provides the SQL family hook and conversion helpers.
 */
const sqlFamilyDescriptor: FamilyDescriptor = {
  kind: 'family',
  id: 'sql',
  hook: sqlTargetFamilyHook,
  verify: {
    readMarker,
    collectSupportedCodecTypeIds,
    verifySchema,
  },
  convertOperationManifest: (manifest: OperationManifest): OperationSignature => {
    return operationManifestToSignature(manifest);
  },
  validateContractIR: (contractJson: unknown) => {
    // Validate the contract (this normalizes and validates structure/logic)
    const validated = validateContract<SqlContract<SqlStorage>>(contractJson);
    // Strip mappings before returning ContractIR (mappings are runtime-only)
    const { mappings: _mappings, ...contractIR } = validated;
    return contractIR;
  },
  stripMappings: (contract: unknown) => {
    // Type guard to check if contract has mappings
    if (typeof contract === 'object' && contract !== null && 'mappings' in contract) {
      const { mappings: _mappings, ...contractIR } = contract as {
        mappings?: unknown;
        [key: string]: unknown;
      };
      return contractIR;
    }
    return contract;
  },
};

export default sqlFamilyDescriptor;
