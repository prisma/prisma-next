import type { OperationManifest } from '@prisma-next/core-control-plane/pack-manifest-types';
import type { FamilyDescriptor } from '@prisma-next/core-control-plane/types';
import type { OperationSignature } from '@prisma-next/operations';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { sqlTargetFamilyHook } from '@prisma-next/sql-contract-emitter';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import type { SqlOperationSignature } from '@prisma-next/sql-operations';
import type { SqlFamilyContext } from './context';
import { introspectSchema, prepareControlContext, verifySchema } from './control-hooks';
import { readMarker } from './marker';

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

class SqlFamilyDescriptor implements FamilyDescriptor<SqlFamilyContext> {
  readonly kind = 'family' as const;
  readonly id = 'sql' as const;
  readonly hook = sqlTargetFamilyHook;
  readonly readMarker = readMarker;
  readonly prepareControlContext = prepareControlContext;
  readonly introspectSchema = introspectSchema;
  readonly verifySchema = verifySchema;
  readonly convertOperationManifest = (manifest: OperationManifest): OperationSignature => {
    return operationManifestToSignature(manifest);
  };
  readonly validateContractIR = (contractJson: unknown) => {
    // Validate the contract (this normalizes and validates structure/logic)
    const validated = validateContract<SqlContract<SqlStorage>>(contractJson);
    // Strip mappings before returning ContractIR (mappings are runtime-only)
    const { mappings: _mappings, ...contractIR } = validated;
    return contractIR;
  };
  readonly stripMappings = (contract: unknown) => {
    // Type guard to check if contract has mappings
    if (typeof contract === 'object' && contract !== null && 'mappings' in contract) {
      const { mappings: _mappings, ...contractIR } = contract as {
        mappings?: unknown;
        [key: string]: unknown;
      };
      return contractIR;
    }
    return contract;
  };
}

const sqlFamilyDescriptor = new SqlFamilyDescriptor();

export default sqlFamilyDescriptor;
