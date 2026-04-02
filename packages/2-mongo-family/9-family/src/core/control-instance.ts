import type { ContractIR } from '@prisma-next/contract/ir';
import type { ContractMarkerRecord } from '@prisma-next/contract/types';
import { emit } from '@prisma-next/core-control-plane/emission';
import type {
  ControlFamilyInstance,
  EmitContractResult,
  SignDatabaseResult,
  VerifyDatabaseResult,
  VerifyDatabaseSchemaResult,
} from '@prisma-next/core-control-plane/types';
import type { ControlStack } from '@prisma-next/framework-components/control';
import type { MongoContract } from '@prisma-next/mongo-core';
import { validateMongoContract } from '@prisma-next/mongo-core';
import { mongoTargetFamilyHook } from '@prisma-next/mongo-emitter';

export interface MongoControlFamilyInstance extends ControlFamilyInstance<'mongo'> {
  validateContractIR(contractJson: unknown): ContractIR;
  emitContract(options: { readonly contractIR: ContractIR | unknown }): Promise<EmitContractResult>;
}

class MongoFamilyInstance implements MongoControlFamilyInstance {
  readonly familyId = 'mongo' as const;

  private readonly assembledState: ControlStack;

  constructor(assembledState: ControlStack) {
    this.assembledState = assembledState;
  }

  validateContractIR(contractJson: unknown): ContractIR {
    const validated = validateMongoContract<MongoContract>(contractJson);
    // MongoContract and ContractIR share structure but are typed independently;
    // validateMongoContract guarantees the shape, so the double cast is safe.
    return validated.contract as unknown as ContractIR;
  }

  async emitContract({
    contractIR,
  }: {
    readonly contractIR: ContractIR | unknown;
  }): Promise<EmitContractResult> {
    // The caller validates via validateContractIR before calling emitContract,
    // so contractIR is guaranteed to be ContractIR at this point.
    const ir = contractIR as ContractIR;
    const {
      codecTypeImports,
      operationTypeImports,
      queryOperationTypeImports,
      extensionIds,
      parameterizedRenderers,
      parameterizedTypeImports,
    } = this.assembledState;

    const result = await emit(
      ir,
      {
        outputDir: '',
        codecTypeImports,
        operationTypeImports,
        queryOperationTypeImports,
        extensionIds,
        parameterizedRenderers,
        parameterizedTypeImports,
      },
      mongoTargetFamilyHook,
    );

    return {
      contractJson: result.contractJson,
      contractDts: result.contractDts,
      storageHash: result.storageHash,
      ...(result.executionHash ? { executionHash: result.executionHash } : {}),
      profileHash: result.profileHash,
    };
  }

  async verify(): Promise<VerifyDatabaseResult> {
    throw new Error('Mongo verify is not implemented');
  }

  async schemaVerify(): Promise<VerifyDatabaseSchemaResult> {
    throw new Error('Mongo schemaVerify is not implemented');
  }

  async sign(): Promise<SignDatabaseResult> {
    throw new Error('Mongo sign is not implemented');
  }

  async readMarker(): Promise<ContractMarkerRecord | null> {
    throw new Error('Mongo readMarker is not implemented');
  }

  async introspect() {
    throw new Error('Mongo introspect is not implemented');
  }
}

export function createMongoFamilyInstance(
  assembledState: ControlStack,
): MongoControlFamilyInstance {
  return new MongoFamilyInstance(assembledState);
}
