// Re-enacts the TML-2633 symptom shape from
// test/integration/test/mongo-runtime/query-builder.test.ts:
// "PlanRow row shapes collapse to _id: never / count: never" when consumers use
// mongoQuery<typeof contract> chains via the facade defineContract wrap.

import mongoFamilyPack from '@prisma-next/family-mongo/pack';
import {
  defineContract as facadeDefineContract,
  field as facadeField,
  model as facadeModel,
} from '@prisma-next/mongo/contract-builder';
import type { MongoContractWithTypeMaps, MongoTypeMaps } from '@prisma-next/mongo-contract';
import {
  defineContract as verboseDefineContract,
  field as verboseField,
  model as verboseModel,
} from '@prisma-next/mongo-contract-ts/contract-builder';
import type { MongoQueryPlan } from '@prisma-next/mongo-query-ast/execution';
import { acc, mongoQuery } from '@prisma-next/mongo-query-builder';
import mongoTargetPack from '@prisma-next/target-mongo/pack';

const facadeOrder = facadeModel('Order', {
  collection: 'orders',
  fields: {
    _id: facadeField.objectId(),
    department: facadeField.string(),
    amount: facadeField.double(),
    status: facadeField.string(),
  },
});

const facadeContract = facadeDefineContract({
  models: { Order: facadeOrder },
});

const verboseOrder = verboseModel('Order', {
  collection: 'orders',
  fields: {
    _id: verboseField.objectId(),
    department: verboseField.string(),
    amount: verboseField.double(),
    status: verboseField.string(),
  },
});

const verboseContract = verboseDefineContract({
  family: mongoFamilyPack,
  target: mongoTargetPack,
  models: { Order: verboseOrder },
});

type FacadeContractType = MongoContractWithTypeMaps<typeof facadeContract, MongoTypeMaps>;
type VerboseContractType = MongoContractWithTypeMaps<typeof verboseContract, MongoTypeMaps>;

type PlanRow<TPlan> = TPlan extends MongoQueryPlan<infer Row> ? Row : never;

const facadeQ = mongoQuery<FacadeContractType>({ contractJson: {} as never });
const verboseQ = mongoQuery<VerboseContractType>({ contractJson: {} as never });

const facadePlan = facadeQ
  .from('orders')
  .match((f) => f.status.eq('completed'))
  .group((f) => ({
    _id: f.department,
    total: acc.sum(f.amount),
    orderCount: acc.count(),
  }))
  .build();

const verbosePlan = verboseQ
  .from('orders')
  .match((f) => f.status.eq('completed'))
  .group((f) => ({
    _id: f.department,
    total: acc.sum(f.amount),
    orderCount: acc.count(),
  }))
  .build();

type FacadePlanRow = PlanRow<typeof facadePlan>;
type VerbosePlanRow = PlanRow<typeof verbosePlan>;

declare const facadeRow: FacadePlanRow;
declare const verboseRow: VerbosePlanRow;

const _facadeRowProbe: '__force_print_facade_planrow__' = facadeRow;
const _verboseRowProbe: '__force_print_verbose_planrow__' = verboseRow;

export { _facadeRowProbe, _verboseRowProbe };
