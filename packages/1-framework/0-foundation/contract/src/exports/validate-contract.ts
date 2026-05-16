export {
  ContractValidationError,
  type ContractValidationPhase,
  type StorageValidator,
  // Framework-internal structural-validation primitive. Not part of the
  // user-facing surface (consumers go through descriptor.contractSerializer);
  // re-exported here so foundation-package consumers (e.g. sql-contract's
  // codec-aware decode wrapper, which backs the SPI's optional decoding
  // path) can compose it.
  validateContract,
} from '../validate-contract';
