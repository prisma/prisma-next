export interface InsertOneResult {
  readonly insertedId: unknown;
}

export interface UpdateOneResult {
  readonly matchedCount: number;
  readonly modifiedCount: number;
}

export interface DeleteOneResult {
  readonly deletedCount: number;
}
