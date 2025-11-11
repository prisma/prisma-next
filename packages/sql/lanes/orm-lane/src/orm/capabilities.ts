import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract-types';
import { errorIncludeCapabilitiesNotTrue, errorIncludeRequiresCapabilities } from '../utils/errors';

export function checkIncludeCapabilities(contract: SqlContract<SqlStorage>): void {
  const target = contract.target;
  const capabilities = contract.capabilities;
  if (!capabilities || !capabilities[target]) {
    errorIncludeRequiresCapabilities();
  }
  const targetCapabilities = capabilities[target];
  if (capabilities[target]['lateral'] !== true || targetCapabilities['jsonAgg'] !== true) {
    errorIncludeCapabilitiesNotTrue();
  }
}
