import { describe, expect, it } from 'vitest';
import { postgresAuthoringFieldPresets } from '../src/core/authoring';

describe('postgresAuthoringFieldPresets', () => {
  it('exposes uuidNative preset with pg/uuid@1 and nativeType uuid', () => {
    expect(postgresAuthoringFieldPresets.uuidNative).toMatchObject({
      kind: 'fieldPreset',
      output: {
        codecId: 'pg/uuid@1',
        nativeType: 'uuid',
      },
    });
  });

  it('exposes id.uuidv4Native preset with pg/uuid@1, uuidv4 generator, and id flag', () => {
    expect(postgresAuthoringFieldPresets.id.uuidv4Native).toMatchObject({
      kind: 'fieldPreset',
      output: {
        codecId: 'pg/uuid@1',
        nativeType: 'uuid',
        executionDefaults: { onCreate: { kind: 'generator', id: 'uuidv4' } },
        id: true,
      },
    });
  });

  it('exposes id.uuidv7Native preset with pg/uuid@1, uuidv7 generator, and id flag', () => {
    expect(postgresAuthoringFieldPresets.id.uuidv7Native).toMatchObject({
      kind: 'fieldPreset',
      output: {
        codecId: 'pg/uuid@1',
        nativeType: 'uuid',
        executionDefaults: { onCreate: { kind: 'generator', id: 'uuidv7' } },
        id: true,
      },
    });
  });
});
