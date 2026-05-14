// `validateContract` is no longer part of the SQL contract package's public surface.
// SQL contract validation now flows through the family-side
// `SqlContractSerializer` SPI implementation; consumers should call
// `descriptor.contractSerializer.deserializeContract(json)` instead.
export {};
