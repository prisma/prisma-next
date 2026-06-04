import { describe, expect, it } from 'vitest';
import { CONTROL_COLLECTION } from '../src/core/control-construction';

describe('control-construction — shape constants', () => {
  it('CONTROL_COLLECTION is the migrations collection name', () => {
    expect(CONTROL_COLLECTION).toBe('_prisma_migrations');
  });
});
