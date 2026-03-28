export type LiteralValue = string | number | boolean | null | Date;
export type MongoValue = MongoParamRef | LiteralValue | MongoDocument | MongoArray;
export interface MongoDocument {
  readonly [key: string]: MongoValue;
}
export interface MongoArray extends ReadonlyArray<MongoValue> {}
export type MongoExpr = MongoDocument;

export class MongoParamRef {
  readonly value: unknown;
  readonly name: string | undefined;
  readonly codecId: string | undefined;

  constructor(value: unknown, options?: { name?: string; codecId?: string }) {
    this.value = value;
    this.name = options?.name;
    this.codecId = options?.codecId;
    Object.freeze(this);
  }
}
