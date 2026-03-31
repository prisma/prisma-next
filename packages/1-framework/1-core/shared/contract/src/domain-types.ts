export type DomainField = {
  readonly nullable: boolean;
  readonly codecId: string;
};

export type DomainRelationOn = {
  readonly localFields: readonly string[];
  readonly targetFields: readonly string[];
};

export type DomainRelation = {
  readonly to: string;
  readonly cardinality: '1:1' | '1:N' | 'N:1';
  readonly strategy: 'reference' | 'embed';
  readonly on?: DomainRelationOn;
};

export type DomainDiscriminator = {
  readonly field: string;
};

export type DomainModel = {
  readonly fields: Record<string, DomainField>;
  readonly relations: Record<string, DomainRelation>;
  readonly storage: Record<string, unknown>;
  readonly discriminator?: DomainDiscriminator;
  readonly variants?: Record<string, unknown>;
  readonly base?: string;
};
