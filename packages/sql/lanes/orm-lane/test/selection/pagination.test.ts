import { describe, expect, it } from 'vitest';
import { createPaginationState } from '../../src/selection/pagination';

describe('pagination', () => {
  it('creates pagination state with limit only', () => {
    const state = createPaginationState(10);
    expect(state).toEqual({ limit: 10 });
    expect(state.offset).toBeUndefined();
  });

  it('creates pagination state with offset only', () => {
    const state = createPaginationState(undefined, 20);
    expect(state).toEqual({ offset: 20 });
    expect(state.limit).toBeUndefined();
  });

  it('creates pagination state with both limit and offset', () => {
    const state = createPaginationState(10, 20);
    expect(state).toEqual({ limit: 10, offset: 20 });
  });

  it('creates empty pagination state when both are undefined', () => {
    const state = createPaginationState();
    expect(state).toEqual({});
    expect(state.limit).toBeUndefined();
    expect(state.offset).toBeUndefined();
  });

  it('creates pagination state with zero values', () => {
    const state = createPaginationState(0, 0);
    expect(state).toEqual({ limit: 0, offset: 0 });
  });

  it('creates pagination state with large values', () => {
    const state = createPaginationState(1000, 5000);
    expect(state).toEqual({ limit: 1000, offset: 5000 });
  });
});
