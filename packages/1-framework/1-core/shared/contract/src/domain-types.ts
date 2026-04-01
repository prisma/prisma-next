export type DomainField = {
  readonly nullable: boolean;
  readonly codecId: string;
};

export type DomainRelationOn = {
  readonly localFields: readonly string[];
  readonly targetFields: readonly string[];
};

export type DomainReferenceRelation = {
  readonly to: string;
  readonly cardinality: '1:1' | '1:N' | 'N:1';
  readonly on: DomainRelationOn;
};

export type DomainEmbedRelation = {
  readonly to: string;
  readonly cardinality: '1:1' | '1:N';
};

export type DomainRelation = DomainReferenceRelation | DomainEmbedRelation;

export type DomainDiscriminator = {
  readonly field: string;
};

export type DomainVariantEntry = {
  readonly value: string;
};

export type DomainModel = {
  readonly fields: Record<string, DomainField>;
  readonly relations: Record<string, DomainRelation>;
  readonly storage: Record<string, unknown>;
  readonly discriminator?: DomainDiscriminator;
  readonly variants?: Record<string, DomainVariantEntry>;
  readonly base?: string;
  readonly owner?: string;
};

type HasModelsWithRelations = {
  readonly models: Record<string, { readonly relations: Record<string, DomainRelation> }>;
};

export type ReferenceRelationKeys<
  TContract extends HasModelsWithRelations,
  ModelName extends string & keyof TContract['models'],
> = {
  [K in keyof TContract['models'][ModelName]['relations']]: TContract['models'][ModelName]['relations'][K] extends DomainReferenceRelation
    ? K
    : never;
}[keyof TContract['models'][ModelName]['relations']];

export type EmbedRelationKeys<
  TContract extends HasModelsWithRelations,
  ModelName extends string & keyof TContract['models'],
> = {
  [K in keyof TContract['models'][ModelName]['relations']]: TContract['models'][ModelName]['relations'][K] extends DomainReferenceRelation
    ? never
    : K;
}[keyof TContract['models'][ModelName]['relations']];
