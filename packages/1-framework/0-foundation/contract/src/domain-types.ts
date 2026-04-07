export type ContractField = {
  readonly nullable: boolean;
  readonly codecId: string;
  readonly typeParams?: Record<string, unknown>;
};

export type ContractRelationOn = {
  readonly localFields: readonly string[];
  readonly targetFields: readonly string[];
};

export type ContractReferenceRelation = {
  readonly to: string;
  readonly cardinality: '1:1' | '1:N' | 'N:1';
  readonly on: ContractRelationOn;
};

export type ContractEmbedRelation = {
  readonly to: string;
  readonly cardinality: '1:1' | '1:N';
};

export type ContractRelation = ContractReferenceRelation | ContractEmbedRelation;

export type ContractDiscriminator = {
  readonly field: string;
};

export type ContractVariantEntry = {
  readonly value: string;
};

export type ModelStorageBase = Readonly<Record<string, unknown>>;

/**
 * Widened model constraint that accepts both structural {@link ContractField}
 * values and rendered types (e.g. `Char<36>`, `Vector<1536>`) produced by
 * parameterized renderers during contract emission.
 *
 * Used as the constraint on `Contract.TModels` so emitted contracts with
 * rendered model-field types satisfy the generic `Contract` interface.
 */
export interface ContractModelBase<TModelStorage extends ModelStorageBase = ModelStorageBase> {
  readonly fields: Readonly<Record<string, unknown>>;
  readonly relations: Record<string, ContractRelation>;
  readonly storage: TModelStorage;
  readonly discriminator?: ContractDiscriminator;
  readonly variants?: Record<string, ContractVariantEntry>;
  readonly base?: string;
  readonly owner?: string;
}

export interface ContractModel<TModelStorage extends ModelStorageBase = ModelStorageBase>
  extends ContractModelBase<TModelStorage> {
  readonly fields: Record<string, ContractField>;
}

// ── Relation key helpers ─────────────────────────────────────────────────────

type HasModelsWithRelations = {
  readonly models: Record<string, { readonly relations: Record<string, ContractRelation> }>;
};

export type ReferenceRelationKeys<
  TContract extends HasModelsWithRelations,
  ModelName extends string & keyof TContract['models'],
> = {
  [K in keyof TContract['models'][ModelName]['relations']]: TContract['models'][ModelName]['relations'][K] extends ContractReferenceRelation
    ? K
    : never;
}[keyof TContract['models'][ModelName]['relations']];

export type EmbedRelationKeys<
  TContract extends HasModelsWithRelations,
  ModelName extends string & keyof TContract['models'],
> = {
  [K in keyof TContract['models'][ModelName]['relations']]: TContract['models'][ModelName]['relations'][K] extends ContractReferenceRelation
    ? never
    : K;
}[keyof TContract['models'][ModelName]['relations']];
