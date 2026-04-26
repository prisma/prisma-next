import type { Contract } from '@prisma-next/contract/types';
import type { ExecutionPlan } from '@prisma-next/framework-components/runtime';
import { runtimeError } from '@prisma-next/framework-components/runtime';
import type { MarkerReader, RuntimeFamilyAdapter } from '@prisma-next/runtime-executor';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { AdapterProfile } from '@prisma-next/sql-relational-core/ast';

export class SqlFamilyAdapter<TContract extends Contract<SqlStorage>>
  implements RuntimeFamilyAdapter<TContract>
{
  readonly contract: TContract;
  readonly markerReader: MarkerReader;

  constructor(contract: TContract, adapterProfile: AdapterProfile) {
    this.contract = contract;
    this.markerReader = adapterProfile;
  }

  validatePlan(plan: ExecutionPlan, contract: TContract): void {
    if (plan.meta.target !== contract.target) {
      throw runtimeError('PLAN.TARGET_MISMATCH', 'Plan target does not match runtime target', {
        planTarget: plan.meta.target,
        runtimeTarget: contract.target,
      });
    }

    if (plan.meta.storageHash !== contract.storage.storageHash) {
      throw runtimeError(
        'PLAN.HASH_MISMATCH',
        'Plan storage hash does not match runtime contract',
        {
          planStorageHash: plan.meta.storageHash,
          runtimeStorageHash: contract.storage.storageHash,
        },
      );
    }
  }
}
