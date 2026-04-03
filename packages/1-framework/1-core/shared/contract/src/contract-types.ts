import type { ContractModel } from './domain-types';
import type { ExecutionSection, ProfileHashBase, StorageBase } from './types';

/**
 * Unified contract representation (ADR 182).
 *
 * A `Contract` is the canonical in-memory representation of a data contract.
 * It is model-first (domain models carry their own storage bridge) and
 * family-parameterized (SQL, Mongo, etc. specialize via `TStorage` and model
 * storage generics on `ContractModel`).
 *
 * JSON persistence fields (`schemaVersion`, `sources`) are not represented
 * here — they are handled at the serialization boundary.
 *
 * @template TStorage  Family-specific storage block (extends {@link StorageBase}).
 * @template TModels   Record of model name → {@link ContractModel} with
 *                     family-specific model storage.
 */
export interface Contract<
  TStorage extends StorageBase = StorageBase,
  TModels extends Record<string, ContractModel> = Record<string, ContractModel>,
> {
  readonly target: string;
  readonly targetFamily: string;
  readonly roots: Record<string, string>;
  readonly models: TModels;
  readonly storage: TStorage;
  readonly capabilities: Record<string, Record<string, boolean>>;
  readonly extensionPacks: Record<string, unknown>;
  readonly execution?: ExecutionSection;
  readonly profileHash?: ProfileHashBase<string>;
  readonly meta: Record<string, unknown>;
}
