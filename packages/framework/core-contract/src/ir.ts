/**
 * ContractIR types and factories for building contract intermediate representation.
 * ContractIR is family-agnostic and used by authoring, emitter, and no-emit runtime.
 */

/**
 * ContractIR represents the intermediate representation of a contract.
 * It is family-agnostic and contains generic storage, models, and relations.
 * Note: coreHash and profileHash are computed by the emitter, not part of the IR.
 */
export interface ContractIR<
  TStorage extends Record<string, unknown> = Record<string, unknown>,
  TModels extends Record<string, unknown> = Record<string, unknown>,
  TRelations extends Record<string, unknown> = Record<string, unknown>,
> {
  readonly schemaVersion: string;
  readonly targetFamily: string;
  readonly target: string;
  readonly models: TModels;
  readonly relations: TRelations;
  readonly storage: TStorage;
  readonly extensions: Record<string, unknown>;
  readonly capabilities: Record<string, Record<string, boolean>>;
  readonly meta: Record<string, unknown>;
  readonly sources: Record<string, unknown>;
}

/**
 * Creates the header portion of a ContractIR.
 * Contains schema version, target, target family, core hash, and optional profile hash.
 */
export function irHeader(opts: {
  target: string;
  targetFamily: string;
  coreHash: string;
  profileHash?: string;
}): {
  readonly schemaVersion: string;
  readonly target: string;
  readonly targetFamily: string;
  readonly coreHash: string;
  readonly profileHash?: string;
} {
  return {
    schemaVersion: '1',
    target: opts.target,
    targetFamily: opts.targetFamily,
    coreHash: opts.coreHash,
    ...(opts.profileHash !== undefined && { profileHash: opts.profileHash }),
  };
}

/**
 * Creates the meta portion of a ContractIR.
 * Contains capabilities, extensions, meta, and sources with empty object defaults.
 * If a field is explicitly `undefined`, it will be omitted (for testing validation).
 */
export function irMeta(opts?: {
  capabilities?: Record<string, Record<string, boolean>> | undefined;
  extensions?: Record<string, unknown> | undefined;
  meta?: Record<string, unknown> | undefined;
  sources?: Record<string, unknown> | undefined;
}): {
  readonly capabilities: Record<string, Record<string, boolean>>;
  readonly extensions: Record<string, unknown>;
  readonly meta: Record<string, unknown>;
  readonly sources: Record<string, unknown>;
} {
  return {
    capabilities: opts?.capabilities ?? {},
    extensions: opts?.extensions ?? {},
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
>(opts: {
  header: {
    readonly schemaVersion: string;
    readonly target: string;
    readonly targetFamily: string;
    readonly coreHash: string;
    readonly profileHash?: string;
  };
  meta: {
    readonly capabilities: Record<string, Record<string, boolean>>;
    readonly extensions: Record<string, unknown>;
    readonly meta: Record<string, unknown>;
    readonly sources: Record<string, unknown>;
  };
  storage: TStorage;
  models: TModels;
  relations: TRelations;
}): ContractIR<TStorage, TModels, TRelations> {
  // ContractIR doesn't include coreHash or profileHash (those are computed by emitter)
  return {
    schemaVersion: opts.header.schemaVersion,
    target: opts.header.target,
    targetFamily: opts.header.targetFamily,
    ...opts.meta,
    storage: opts.storage,
    models: opts.models,
    relations: opts.relations,
  };
}
