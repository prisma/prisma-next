import { describe, expect, it } from 'vitest';
import { isParentToSenderPayload, type ParentToSenderPayload } from '../src/payload';

const validPayload: ParentToSenderPayload = {
  installationId: 'install-uuid',
  version: '0.9.0',
  command: 'prisma-next init',
  flags: ['--target'],
  projectRoot: '/abs/project',
  endpoint: 'https://example.test/events',
};

describe('isParentToSenderPayload', () => {
  it('accepts a full valid payload', () => {
    expect(isParentToSenderPayload(validPayload)).toBe(true);
  });

  it('accepts an empty flags array', () => {
    expect(isParentToSenderPayload({ ...validPayload, flags: [] })).toBe(true);
  });

  it('accepts a payload with the optional databaseTarget override set to a string', () => {
    expect(isParentToSenderPayload({ ...validPayload, databaseTarget: 'postgres' })).toBe(true);
  });

  it('accepts a payload with the optional databaseTarget override set to null', () => {
    expect(isParentToSenderPayload({ ...validPayload, databaseTarget: null })).toBe(true);
  });

  it('rejects a payload whose databaseTarget override is the wrong type', () => {
    expect(isParentToSenderPayload({ ...validPayload, databaseTarget: 42 })).toBe(false);
    expect(isParentToSenderPayload({ ...validPayload, databaseTarget: ['postgres'] })).toBe(false);
  });

  it('rejects non-objects', () => {
    expect(isParentToSenderPayload(null)).toBe(false);
    expect(isParentToSenderPayload(undefined)).toBe(false);
    expect(isParentToSenderPayload('payload')).toBe(false);
    expect(isParentToSenderPayload(42)).toBe(false);
  });

  for (const key of [
    'installationId',
    'version',
    'command',
    'flags',
    'projectRoot',
    'endpoint',
  ] as const) {
    it(`rejects payloads missing required field ${key}`, () => {
      const partial: Record<string, unknown> = { ...validPayload };
      delete partial[key];
      expect(isParentToSenderPayload(partial)).toBe(false);
    });
  }

  it('rejects an empty installationId', () => {
    expect(isParentToSenderPayload({ ...validPayload, installationId: '' })).toBe(false);
  });

  it('rejects an empty endpoint', () => {
    expect(isParentToSenderPayload({ ...validPayload, endpoint: '' })).toBe(false);
  });

  it('rejects flags when it is not a string array', () => {
    expect(isParentToSenderPayload({ ...validPayload, flags: 'not-an-array' })).toBe(false);
    expect(isParentToSenderPayload({ ...validPayload, flags: [42] })).toBe(false);
  });

  it('rejects a number where a string is expected', () => {
    expect(isParentToSenderPayload({ ...validPayload, version: 123 })).toBe(false);
    expect(isParentToSenderPayload({ ...validPayload, projectRoot: 0 })).toBe(false);
  });
});
