export type ContractField = {
  readonly nullable: boolean;
  readonly codecId: string;
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

export interface ContractModel<TModelStorage extends ModelStorageBase = ModelStorageBase> {
  readonly fields: Record<string, ContractField>;
  readonly relations: Record<string, ContractRelation>;
  readonly storage: TModelStorage;
  readonly discriminator?: ContractDiscriminator;
  readonly variants?: Record<string, ContractVariantEntry>;
  readonly base?: string;
  readonly owner?: string;
}

// ── Backward-compatible aliases ──────────────────────────────────────────────

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
