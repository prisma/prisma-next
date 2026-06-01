import type { CrossReference } from './cross-reference';

export type ScalarFieldType = {
  readonly kind: 'scalar';
  readonly codecId: string;
  readonly typeParams?: Record<string, unknown>;
};

export type ValueObjectFieldType = {
  readonly kind: 'valueObject';
  readonly name: string;
};

export type UnionFieldType = {
  readonly kind: 'union';
  readonly members: ReadonlyArray<ScalarFieldType | ValueObjectFieldType>;
};

export type ContractFieldType = ScalarFieldType | ValueObjectFieldType | UnionFieldType;

export type ContractField = {
  readonly nullable: boolean;
  readonly type: ContractFieldType;
  readonly many?: true;
  readonly dict?: true;
};

export type ContractRelationOn = {
  readonly localFields: readonly string[];
  readonly targetFields: readonly string[];
};

export type ContractRelationThrough = {
  readonly table: string;
  readonly parentColumns: readonly string[];
  readonly childColumns: readonly string[];
  readonly targetColumns: readonly string[];
};

export type ContractReferenceRelation = {
  readonly to: CrossReference;
  readonly cardinality: '1:1' | '1:N' | 'N:1' | 'N:M';
  readonly on: ContractRelationOn;
  readonly through?: ContractRelationThrough;
};

export type ContractEmbedRelation = {
  readonly to: CrossReference;
  readonly cardinality: '1:1' | '1:N';
};

export type ContractRelation = ContractReferenceRelation | ContractEmbedRelation;

export type ContractDiscriminator = {
  readonly field: string;
};

export type ContractVariantEntry = {
  readonly value: string;
};

export type ContractValueObject = {
  readonly fields: Record<string, ContractField>;
};

export type ModelStorageBase = Readonly<Record<string, unknown>>;

export interface ContractModelBase<TModelStorage extends ModelStorageBase = ModelStorageBase> {
  readonly fields: Record<string, ContractField>;
  readonly relations: Record<string, ContractRelation>;
  readonly storage: TModelStorage;
  readonly discriminator?: ContractDiscriminator;
  readonly variants?: Record<string, ContractVariantEntry>;
  readonly base?: CrossReference;
  readonly owner?: string;
}

export interface ContractModel<TModelStorage extends ModelStorageBase = ModelStorageBase>
  extends ContractModelBase<TModelStorage> {
  readonly fields: Record<string, ContractField>;
}

// ── Relation key helpers ─────────────────────────────────────────────────────

export type ReferenceRelationKeys<
  TModels extends Record<string, { readonly relations: Record<string, ContractRelation> }>,
  ModelName extends string & keyof TModels,
> = {
  [K in keyof TModels[ModelName]['relations']]: TModels[ModelName]['relations'][K] extends ContractReferenceRelation
    ? K
    : never;
}[keyof TModels[ModelName]['relations']];

export type EmbedRelationKeys<
  TModels extends Record<string, { readonly relations: Record<string, ContractRelation> }>,
  ModelName extends string & keyof TModels,
> = {
  [K in keyof TModels[ModelName]['relations']]: TModels[ModelName]['relations'][K] extends ContractReferenceRelation
    ? never
    : K;
}[keyof TModels[ModelName]['relations']];
