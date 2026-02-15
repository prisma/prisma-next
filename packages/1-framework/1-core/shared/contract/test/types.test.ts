import { describe, expect, it } from 'vitest';
import type { ParamDescriptor, PlanMeta } from '../src/types';

describe('ParamDescriptor', () => {
  describe('source', () => {
    it('accepts source dsl', () => {
      const d: ParamDescriptor = { index: 1, source: 'dsl' };
      expect(d.source).toBe('dsl');
    });

    it('accepts source raw', () => {
      const d: ParamDescriptor = { index: 1, source: 'raw' };
      expect(d.source).toBe('raw');
    });

    it('accepts source lane', () => {
      const d: ParamDescriptor = { index: 1, source: 'lane' };
      expect(d.source).toBe('lane');
    });

    it('paramDescriptors with lane source in PlanMeta', () => {
      const meta: PlanMeta = {
        target: 'postgres',
        storageHash: 'sha256:test',
        lane: 'kysely',
        paramDescriptors: [{ index: 1, source: 'lane', refs: { table: 'user', column: 'id' } }],
      };
      expect(meta.paramDescriptors).toHaveLength(1);
      expect(meta.paramDescriptors[0]?.source).toBe('lane');
      expect(meta.paramDescriptors[0]?.refs).toEqual({ table: 'user', column: 'id' });
    });
  });
});
