import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import {
  errorIncludeCapabilitiesNotTrue,
  errorIncludeRequiresCapabilities,
  errorReturningCapabilityNotTrue,
  errorReturningRequiresCapability,
} from './errors.ts';

export function checkIncludeCapabilities(contract: SqlContract<SqlStorage>): void {
  const target = contract.target;
  const contractCapabilities = contract.capabilities;
  const declaredTargetCapabilities = contractCapabilities?.[target];

  if (!contractCapabilities || !declaredTargetCapabilities) {
    errorIncludeRequiresCapabilities(target);
  }

  if (
    declaredTargetCapabilities['lateral'] !== true ||
    declaredTargetCapabilities['jsonAgg'] !== true
  ) {
    errorIncludeCapabilitiesNotTrue(target, {
      lateral: declaredTargetCapabilities['lateral'],
      jsonAgg: declaredTargetCapabilities['jsonAgg'],
    });
  }
}

export function checkReturningCapability(contract: SqlContract<SqlStorage>): void {
  const target = contract.target;
  const capabilities = contract.capabilities;
  if (!capabilities || !capabilities[target]) {
    errorReturningRequiresCapability(target);
  }
  const targetCapabilities = capabilities[target];
  if (targetCapabilities['returning'] !== true) {
    errorReturningCapabilityNotTrue(target, targetCapabilities['returning']);
  }
}
