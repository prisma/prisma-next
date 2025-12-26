export interface PaginationState {
  limit?: number;
  offset?: number;
}

export function createPaginationState(limit?: number, offset?: number): PaginationState {
  return {
    ...(limit !== undefined ? { limit } : {}),
    ...(offset !== undefined ? { offset } : {}),
  };
}
