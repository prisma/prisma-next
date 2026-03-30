import { type as arktypeType } from 'arktype';
import { MongoContractSchema } from './contract-schema';
import type { MongoContract } from './contract-types';
import { validateContractDomain } from './validate-domain';
import { validateMongoStorage } from './validate-storage';

export interface MongoContractIndices {
  readonly variantToBase: Record<string, string>;
  readonly modelToVariants: Record<string, string[]>;
}

export interface ValidatedMongoContract<TContract extends MongoContract> {
  readonly contract: TContract;
  readonly indices: MongoContractIndices;
  readonly warnings: string[];
}

export function validateMongoContract<TContract extends MongoContract>(
  value: unknown,
): ValidatedMongoContract<TContract> {
  const parsed = MongoContractSchema(value);
  if (parsed instanceof arktypeType.errors) {
    throw new Error(`Contract structural validation failed: ${parsed.summary}`);
  }

  const contract = parsed as unknown as TContract;

  const { warnings } = validateContractDomain(contract);
  validateMongoStorage(contract);

  const indices = buildIndices(contract);

  return { contract, indices, warnings };
}

function buildIndices(contract: MongoContract): MongoContractIndices {
  const variantToBase: Record<string, string> = {};
  const modelToVariants: Record<string, string[]> = {};

  for (const [modelName, model] of Object.entries(contract.models)) {
    if (model.base) {
      variantToBase[modelName] = model.base;
    }
    if (model.variants) {
      modelToVariants[modelName] = Object.keys(model.variants);
    }
  }

  return { variantToBase, modelToVariants };
}
