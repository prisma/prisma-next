import type { Contract } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { SqlContractSerializerBase } from './sql-contract-serializer-base';

/**
 * Default SQL family `ContractSerializer` concretion. Inherits the
 * full SQL-shared deserialization pipeline (structural validation +
 * IR-class hydration) without pack-registered `storage.types`
 * hydration factories — targets that emit polymorphic JSON outside the
 * codec-typed envelope wire a target-specific subclass with a populated
 * registry (see Postgres). Family-level call sites instantiate this
 * default directly when no target serializer is supplied.
 */
export class SqlContractSerializer extends SqlContractSerializerBase<Contract<SqlStorage>> {
  constructor() {
    super(new Map());
  }
}
