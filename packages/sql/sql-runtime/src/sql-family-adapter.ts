import type { Plan } from '@prisma-next/contract/types';
import type {
  MarkerReader,
  MarkerStatement,
  RuntimeFamilyAdapter,
} from '@prisma-next/runtime-executor';
import { runtimeError } from '@prisma-next/runtime-executor';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { readContractMarker } from './sql-marker';

class SqlMarkerReader implements MarkerReader {
  readMarkerStatement(): MarkerStatement {
    return readContractMarker();
  }
}

export class SqlFamilyAdapter<TContract extends SqlContract<SqlStorage>>
  implements RuntimeFamilyAdapter<TContract>
{
  readonly contract: TContract;
  readonly markerReader: MarkerReader;

  constructor(contract: TContract) {
    this.contract = contract;
    this.markerReader = new SqlMarkerReader();
  }

  validatePlan(plan: Plan, contract: TContract): void {
    if (plan.meta.target !== contract.target) {
      throw runtimeError('PLAN.TARGET_MISMATCH', 'Plan target does not match runtime target', {
        planTarget: plan.meta.target,
        runtimeTarget: contract.target,
      });
    }

    if (plan.meta.coreHash !== contract.coreHash) {
      throw runtimeError('PLAN.HASH_MISMATCH', 'Plan core hash does not match runtime contract', {
        planCoreHash: plan.meta.coreHash,
        runtimeCoreHash: contract.coreHash,
      });
    }
  }
}
