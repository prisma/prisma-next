import { describe, expect, it } from 'vitest';
import { sqlFamilyAuthoringFieldPresets } from '../src/core/authoring-field-presets';

describe('sqlFamilyAuthoringFieldPresets', () => {
  it('exposes uuidString preset with char(36) codec', () => {
    expect(sqlFamilyAuthoringFieldPresets.uuidString).toMatchObject({
      kind: 'fieldPreset',
      output: {
        codecId: 'sql/char@1',
        nativeType: 'character',
        typeParams: { length: 36 },
      },
    });
  });

  it('does not expose a plain uuid preset', () => {
    expect('uuid' in sqlFamilyAuthoringFieldPresets).toBe(false);
  });

  it('exposes id.uuidv4String preset with char(36) codec and uuidv4 generator', () => {
    expect(sqlFamilyAuthoringFieldPresets.id.uuidv4String).toMatchObject({
      kind: 'fieldPreset',
      output: {
        codecId: 'sql/char@1',
        nativeType: 'character',
        typeParams: { length: 36 },
        executionDefaults: { onCreate: { kind: 'generator', id: 'uuidv4' } },
        id: true,
      },
    });
  });

  it('exposes id.uuidv7String preset with char(36) codec and uuidv7 generator', () => {
    expect(sqlFamilyAuthoringFieldPresets.id.uuidv7String).toMatchObject({
      kind: 'fieldPreset',
      output: {
        codecId: 'sql/char@1',
        nativeType: 'character',
        typeParams: { length: 36 },
        executionDefaults: { onCreate: { kind: 'generator', id: 'uuidv7' } },
        id: true,
      },
    });
  });

  it('does not expose plain id.uuidv4 or id.uuidv7 presets', () => {
    expect('uuidv4' in sqlFamilyAuthoringFieldPresets.id).toBe(false);
    expect('uuidv7' in sqlFamilyAuthoringFieldPresets.id).toBe(false);
  });

  it('keeps ulid, nanoid, cuid2, ksuid presets unchanged', () => {
    expect('ulid' in sqlFamilyAuthoringFieldPresets).toBe(true);
    expect('nanoid' in sqlFamilyAuthoringFieldPresets).toBe(true);
    expect('cuid2' in sqlFamilyAuthoringFieldPresets).toBe(true);
    expect('ksuid' in sqlFamilyAuthoringFieldPresets).toBe(true);
    expect('ulid' in sqlFamilyAuthoringFieldPresets.id).toBe(true);
    expect('nanoid' in sqlFamilyAuthoringFieldPresets.id).toBe(true);
    expect('cuid2' in sqlFamilyAuthoringFieldPresets.id).toBe(true);
    expect('ksuid' in sqlFamilyAuthoringFieldPresets.id).toBe(true);
  });
});
