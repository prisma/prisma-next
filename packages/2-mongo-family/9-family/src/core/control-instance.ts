import type { Contract, ContractMarkerRecord } from '@prisma-next/contract/types';
import type {
  ControlFamilyInstance,
  SignDatabaseResult,
  VerifyDatabaseResult,
  VerifyDatabaseSchemaResult,
} from '@prisma-next/core-control-plane/types';
import type { ControlStack } from '@prisma-next/framework-components/control';
import type { MongoContract } from '@prisma-next/mongo-core';
import { validateMongoContract } from '@prisma-next/mongo-core';

export interface MongoControlFamilyInstance extends ControlFamilyInstance<'mongo'> {
  validateContract(contractJson: unknown): Contract;
}

class MongoFamilyInstance implements MongoControlFamilyInstance {
  readonly familyId = 'mongo' as const;

  constructor(_controlStack: ControlStack) {}

  validateContract(contractJson: unknown): Contract {
    const validated = validateMongoContract<MongoContract>(contractJson);
    // MongoContract and Contract share structure but are typed independently;
    // validateMongoContract guarantees the shape, so the double cast is safe.
    return validated.contract as unknown as Contract;
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

export function createMongoFamilyInstance(controlStack: ControlStack): MongoControlFamilyInstance {
  return new MongoFamilyInstance(controlStack);
}
