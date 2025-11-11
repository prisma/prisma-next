import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import {
  errorIncludeCapabilitiesNotTrue,
  errorIncludeRequiresCapabilities,
  errorReturningCapabilityNotTrue,
  errorReturningRequiresCapability,
} from './errors';

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

export function checkReturningCapability(contract: SqlContract<SqlStorage>): void {
  const target = contract.target;
  const capabilities = contract.capabilities;
  if (!capabilities || !capabilities[target]) {
    errorReturningRequiresCapability();
  }
  const targetCapabilities = capabilities[target];
  if (targetCapabilities['returning'] !== true) {
    errorReturningCapabilityNotTrue();
  }
}
