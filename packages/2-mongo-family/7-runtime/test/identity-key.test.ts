import type { PlanMeta } from '@prisma-next/contract/types';
import {
  AggregateWireCommand,
  DeleteOneWireCommand,
  InsertOneWireCommand,
  UpdateOneWireCommand,
} from '@prisma-next/mongo-wire';
import { describe, expect, it } from 'vitest';
import { computeMongoIdentityKey } from '../src/identity-key';
import type { MongoExecutionPlan } from '../src/mongo-execution-plan';

function makeMeta(overrides?: Partial<PlanMeta>): PlanMeta {
  return {
    target: 'mongodb',
    storageHash: 'sha256:test',
    lane: 'mongo',
    paramDescriptors: [],
    ...overrides,
  };
}

function makeExec(overrides?: {
  command?: MongoExecutionPlan['command'];
  meta?: Partial<PlanMeta>;
}): MongoExecutionPlan {
  return {
    command: overrides?.command ?? new InsertOneWireCommand('users', { _id: 'a' }),
    meta: makeMeta(overrides?.meta),
  };
}

describe('computeMongoIdentityKey', () => {
  describe('stability', () => {
    it('returns the same key for plans with equivalent commands', () => {
      const a = makeExec({
        command: new InsertOneWireCommand('users', { _id: 'a', name: 'Alice' }),
      });
      const b = makeExec({
        command: new InsertOneWireCommand('users', { _id: 'a', name: 'Alice' }),
      });
      expect(computeMongoIdentityKey(a)).toBe(computeMongoIdentityKey(b));
    });

    it('returns the same key across repeated invocations', () => {
      const exec = makeExec({
        command: new UpdateOneWireCommand('users', { _id: 'a' }, { $set: { active: true } }),
      });
      const first = computeMongoIdentityKey(exec);
      const second = computeMongoIdentityKey(exec);
      const third = computeMongoIdentityKey(exec);
      expect(first).toBe(second);
      expect(second).toBe(third);
    });

    it('is insensitive to object key insertion order in the document', () => {
      const a = makeExec({
        command: new InsertOneWireCommand('users', { name: 'Alice', age: 30 }),
      });
      const b = makeExec({
        command: new InsertOneWireCommand('users', { age: 30, name: 'Alice' }),
      });
      expect(computeMongoIdentityKey(a)).toBe(computeMongoIdentityKey(b));
    });

    it('is insensitive to nested object key order in the filter', () => {
      const a = makeExec({
        command: new UpdateOneWireCommand(
          'users',
          { profile: { city: 'Berlin', country: 'DE' } },
          { $set: { active: true } },
        ),
      });
      const b = makeExec({
        command: new UpdateOneWireCommand(
          'users',
          { profile: { country: 'DE', city: 'Berlin' } },
          { $set: { active: true } },
        ),
      });
      expect(computeMongoIdentityKey(a)).toBe(computeMongoIdentityKey(b));
    });
  });

  describe('discrimination', () => {
    it('discriminates on differing storageHash with the same command', () => {
      const command = new InsertOneWireCommand('users', { _id: 'a' });
      const a = makeExec({ command, meta: { storageHash: 'sha256:v1' } });
      const b = makeExec({ command, meta: { storageHash: 'sha256:v2' } });
      expect(computeMongoIdentityKey(a)).not.toBe(computeMongoIdentityKey(b));
    });

    it('discriminates on differing collection names', () => {
      const a = makeExec({ command: new InsertOneWireCommand('users', { _id: 'a' }) });
      const b = makeExec({ command: new InsertOneWireCommand('orders', { _id: 'a' }) });
      expect(computeMongoIdentityKey(a)).not.toBe(computeMongoIdentityKey(b));
    });

    it('discriminates on differing command kinds (insertOne vs updateOne)', () => {
      const a = makeExec({ command: new InsertOneWireCommand('users', { _id: 'a' }) });
      const b = makeExec({
        command: new UpdateOneWireCommand('users', { _id: 'a' }, { $set: { _id: 'a' } }),
      });
      expect(computeMongoIdentityKey(a)).not.toBe(computeMongoIdentityKey(b));
    });

    it('discriminates on differing document values', () => {
      const a = makeExec({ command: new InsertOneWireCommand('users', { name: 'Alice' }) });
      const b = makeExec({ command: new InsertOneWireCommand('users', { name: 'Bob' }) });
      expect(computeMongoIdentityKey(a)).not.toBe(computeMongoIdentityKey(b));
    });

    it('discriminates on differing filter values for the same kind', () => {
      const a = makeExec({
        command: new DeleteOneWireCommand('users', { _id: 'a' }),
      });
      const b = makeExec({
        command: new DeleteOneWireCommand('users', { _id: 'b' }),
      });
      expect(computeMongoIdentityKey(a)).not.toBe(computeMongoIdentityKey(b));
    });

    it('discriminates on differing aggregate pipelines', () => {
      const a = makeExec({
        command: new AggregateWireCommand('users', [{ $match: { active: true } }]),
      });
      const b = makeExec({
        command: new AggregateWireCommand('users', [{ $match: { active: false } }]),
      });
      expect(computeMongoIdentityKey(a)).not.toBe(computeMongoIdentityKey(b));
    });

    it('discriminates on pipeline stage order (arrays are order-significant)', () => {
      const a = makeExec({
        command: new AggregateWireCommand('users', [
          { $match: { active: true } },
          { $sort: { name: 1 } },
        ]),
      });
      const b = makeExec({
        command: new AggregateWireCommand('users', [
          { $sort: { name: 1 } },
          { $match: { active: true } },
        ]),
      });
      expect(computeMongoIdentityKey(a)).not.toBe(computeMongoIdentityKey(b));
    });
  });

  describe('shape', () => {
    it('returns a fixed-size hashIdentity digest', () => {
      const exec = makeExec({
        command: new InsertOneWireCommand('users', { _id: 'a' }),
        meta: { storageHash: 'sha256:abc' },
      });
      const key = computeMongoIdentityKey(exec);
      expect(key).toMatch(/^blake2b512:[0-9a-f]{128}$/);
    });

    it('does not embed the raw command payload in its output (opacity)', () => {
      const sensitiveValue = 'super-secret-token-1234567890';
      const exec = makeExec({
        command: new InsertOneWireCommand('users', { token: sensitiveValue }),
      });
      const key = computeMongoIdentityKey(exec);
      expect(key).not.toContain(sensitiveValue);
      expect(key).not.toContain('users');
    });

    it('produces a fixed-size key regardless of payload size', () => {
      const small = makeExec({
        command: new InsertOneWireCommand('users', { _id: 'a' }),
      });
      const large = makeExec({
        command: new InsertOneWireCommand('users', { _id: 'a', blob: 'x'.repeat(1_000_000) }),
      });
      expect(computeMongoIdentityKey(small).length).toBe(computeMongoIdentityKey(large).length);
    });
  });
});
