import type { ExecutionPlan } from '@prisma-next/contract/types';
import type {
  MarkerReader,
  MarkerStatement,
  RuntimeFamilyAdapter,
} from '@prisma-next/runtime-executor';
import { runtimeError } from '@prisma-next/runtime-executor';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { readContractMarker } from './sql-marker';

type MarkerReaderStatementProvider = {
  markerReaderStatement?: () => { readonly sql: string; readonly params: readonly unknown[] };
};

class SqlMarkerReader implements MarkerReader {
  constructor(private readonly provider?: MarkerReaderStatementProvider) {}

  readMarkerStatement(): MarkerStatement {
    if (this.provider?.markerReaderStatement) {
      return this.provider.markerReaderStatement();
    }
    return readContractMarker();
  }
}

export class SqlFamilyAdapter<TContract extends SqlContract<SqlStorage>>
  implements RuntimeFamilyAdapter<TContract>
{
  readonly contract: TContract;
  readonly markerReader: MarkerReader;

  constructor(contract: TContract, markerProvider?: MarkerReaderStatementProvider) {
    this.contract = contract;
    this.markerReader = new SqlMarkerReader(markerProvider);
  }

  validatePlan(plan: ExecutionPlan, contract: TContract): void {
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
