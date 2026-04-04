export interface InsertOneResult {
  readonly insertedId: unknown;
}

export interface InsertManyResult {
  readonly insertedIds: ReadonlyArray<unknown>;
  readonly insertedCount: number;
}

export interface UpdateOneResult {
  readonly matchedCount: number;
  readonly modifiedCount: number;
}

export interface UpdateManyResult {
  readonly matchedCount: number;
  readonly modifiedCount: number;
}

export interface DeleteOneResult {
  readonly deletedCount: number;
}

export interface DeleteManyResult {
  readonly deletedCount: number;
}
