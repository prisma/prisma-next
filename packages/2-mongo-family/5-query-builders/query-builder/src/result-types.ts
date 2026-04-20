/**
 * Wire-result row types for write terminals. The runtime/driver yields a
 * single result document per write command — these types describe its shape
 * so callers receive a typed plan rather than `unknown`.
 */
export interface InsertOneResult {
  readonly insertedId: unknown;
  readonly acknowledged?: boolean;
}

export interface InsertManyResult {
  readonly insertedIds: ReadonlyArray<unknown>;
  readonly insertedCount: number;
  readonly acknowledged?: boolean;
}

export interface UpdateResult {
  readonly matchedCount: number;
  readonly modifiedCount: number;
  readonly upsertedCount?: number;
  readonly upsertedId?: unknown;
  readonly acknowledged?: boolean;
}

export interface DeleteResult {
  readonly deletedCount: number;
  readonly acknowledged?: boolean;
}
