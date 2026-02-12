function ifDefined<K extends string, V>(
  key: K,
  value: V | undefined,
): Record<never, never> | { [P in K]: V } {
  return value !== undefined ? ({ [key]: value } as { [P in K]: V }) : {};
}

/**
 * ContractIR types and factories for building contract intermediate representation.
 * ContractIR is family-agnostic and used by authoring, emitter, and no-emit runtime.
 */

/**
 * ContractIR represents the intermediate representation of a contract.
 * It is family-agnostic and contains generic storage, models, and relations.
 * Note: storageHash/executionHash and profileHash are computed by the emitter, not part of the IR.
 */
export interface ContractIR<
  TStorage extends Record<string, unknown> = Record<string, unknown>,
  TModels extends Record<string, unknown> = Record<string, unknown>,
  TRelations extends Record<string, unknown> = Record<string, unknown>,
  TExecution extends Record<string, unknown> = Record<string, unknown>,
> {
  readonly schemaVersion: string;
  readonly targetFamily: string;
  readonly target: string;
  readonly models: TModels;
  readonly relations: TRelations;
  readonly storage: TStorage;
  readonly execution?: TExecution;
  readonly extensionPacks: Record<string, unknown>;
  readonly capabilities: Record<string, Record<string, boolean>>;
  readonly meta: Record<string, unknown>;
  readonly sources: Record<string, unknown>;
}

/**
 * Creates the header portion of a ContractIR.
 * Contains schema version, target, target family, storage hash, and optional profile hash.
 */
export function irHeader(opts: {
  target: string;
  targetFamily: string;
  storageHash: string;
  executionHash?: string | undefined;
  profileHash?: string | undefined;
}): {
  readonly schemaVersion: string;
  readonly target: string;
  readonly targetFamily: string;
  readonly storageHash: string;
  readonly executionHash?: string | undefined;
  readonly profileHash?: string | undefined;
} {
  return {
    schemaVersion: '1',
    target: opts.target,
    targetFamily: opts.targetFamily,
    storageHash: opts.storageHash,
    ...ifDefined('executionHash', opts.executionHash),
    ...ifDefined('profileHash', opts.profileHash),
  };
}

/**
 * Creates the meta portion of a ContractIR.
 * Contains capabilities, extensionPacks, meta, and sources with empty object defaults.
 * If a field is explicitly `undefined`, it will be omitted (for testing validation).
 */
export function irMeta(opts?: {
  capabilities?: Record<string, Record<string, boolean>> | undefined;
  extensionPacks?: Record<string, unknown> | undefined;
  meta?: Record<string, unknown> | undefined;
  sources?: Record<string, unknown> | undefined;
}): {
  readonly capabilities: Record<string, Record<string, boolean>>;
  readonly extensionPacks: Record<string, unknown>;
  readonly meta: Record<string, unknown>;
  readonly sources: Record<string, unknown>;
} {
  return {
    capabilities: opts?.capabilities ?? {},
    extensionPacks: opts?.extensionPacks ?? {},
    meta: opts?.meta ?? {},
    sources: opts?.sources ?? {},
  };
}

/**
 * Creates a complete ContractIR by combining header, meta, and family-specific sections.
 * This is a family-agnostic factory that accepts generic storage, models, and relations.
 */
export function contractIR<
  TStorage extends Record<string, unknown>,
  TModels extends Record<string, unknown>,
  TRelations extends Record<string, unknown>,
  TExecution extends Record<string, unknown>,
>(opts: {
  header: {
    readonly schemaVersion: string;
    readonly target: string;
    readonly targetFamily: string;
    readonly storageHash: string;
    readonly executionHash?: string | undefined;
    readonly profileHash?: string | undefined;
  };
  meta: {
    readonly capabilities: Record<string, Record<string, boolean>>;
    readonly extensionPacks: Record<string, unknown>;
    readonly meta: Record<string, unknown>;
    readonly sources: Record<string, unknown>;
  };
  storage: TStorage;
  models: TModels;
  relations: TRelations;
  execution?: TExecution;
}): ContractIR<TStorage, TModels, TRelations, TExecution> {
  // ContractIR doesn't include storageHash/executionHash or profileHash (those are computed by emitter)
  return {
    schemaVersion: opts.header.schemaVersion,
    target: opts.header.target,
    targetFamily: opts.header.targetFamily,
    ...opts.meta,
    storage: opts.storage,
    models: opts.models,
    relations: opts.relations,
    ...ifDefined('execution', opts.execution),
  };
}
