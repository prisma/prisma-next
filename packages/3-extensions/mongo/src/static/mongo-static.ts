import mongoRuntimeAdapter from '@prisma-next/adapter-mongo/runtime';
import { buildNamespacedEnums, type NamespacedEnums } from '@prisma-next/contract/enum-accessor';
import { MongoContractSerializer } from '@prisma-next/family-mongo/ir';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import type {
  AnyMongoTypeMaps,
  MongoContract,
  MongoContractWithTypeMaps,
} from '@prisma-next/mongo-contract';
import { mongoQuery } from '@prisma-next/mongo-query-builder';
import {
  createMongoExecutionContext,
  createMongoExecutionStack,
  type MongoExecutionContext,
} from '@prisma-next/mongo-runtime';
import mongoRuntimeTarget from '@prisma-next/target-mongo/runtime';
import { assertDefined } from '@prisma-next/utils/assertions';
import { blindCast } from '@prisma-next/utils/casts';

type UnboundEnums<TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>> =
  NamespacedEnums<TContract>[typeof UNBOUND_NAMESPACE_ID];

function extractUnboundEnums<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
>(contract: TContract): UnboundEnums<TContract> {
  const enums = buildNamespacedEnums<TContract>(contract.domain)[UNBOUND_NAMESPACE_ID];
  assertDefined(enums, 'the unbound namespace always exists on a mongo builder output');
  return enums;
}

export interface MongoStaticContext<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
> {
  readonly context: MongoExecutionContext<TContract>;
  readonly contract: TContract;
  readonly enums: UnboundEnums<TContract>;
  readonly query: ReturnType<typeof mongoQuery<TContract>>;
}

export function buildMongoStaticContext<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
>(contract: TContract): MongoStaticContext<TContract> {
  const stack = createMongoExecutionStack({
    target: mongoRuntimeTarget,
    adapter: mongoRuntimeAdapter,
  });
  const context = createMongoExecutionContext<TContract>({ contract, stack });
  const enums = extractUnboundEnums(contract);
  const query = mongoQuery<TContract>({ contractJson: contract });
  return { context, contract, enums, query };
}

export default function mongoStatic<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
>(options: { readonly contractJson: unknown }): MongoStaticContext<TContract> {
  const contract = blindCast<
    TContract,
    'MongoContractSerializer validates and returns a typed contract'
  >(new MongoContractSerializer().deserializeContract(options.contractJson));
  return buildMongoStaticContext(contract);
}
