import { validateContractDomain } from '@prisma-next/contract/validate-domain';
import { type as arktypeType } from 'arktype';
import { MongoContractSchema } from './contract-schema';
import type { MongoContract } from './contract-types';
import { validateMongoStorage } from './validate-storage';

export interface MongoContractIndices {
  readonly variantToBase: Record<string, string>;
  readonly modelToVariants: Record<string, string[]>;
}

export interface ValidatedMongoContract<TContract extends MongoContract> {
  readonly contract: TContract;
  readonly indices: MongoContractIndices;
}

export function validateMongoContract<TContract extends MongoContract>(
  value: unknown,
): ValidatedMongoContract<TContract> {
  const parsed = MongoContractSchema(value);
  if (parsed instanceof arktypeType.errors) {
    throw new Error(`Contract structural validation failed: ${parsed.summary}`);
  }

  // arktype's `infer`d type for `MongoContractSchema` is structurally
  // equivalent to `MongoContract` but not nominally so (arktype DSL output
  // types differ on optional/readonly modifiers, narrowed-literal positions,
  // and utility-type wrappings from the hand-authored generic
  // `MongoContract<S, M>` surface). The double cast is the documented
  // escape hatch from arktype's nominal-output representation to the
  // project's nominal-contract representation; the schema and the type are
  // kept in lockstep by the round-trip fixtures under `test/validate.test.ts`.
  const contract = parsed as unknown as TContract;

  validateContractDomain(contract);
  validateMongoStorage(contract);

  const indices = buildIndices(contract);

  return { contract, indices };
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
