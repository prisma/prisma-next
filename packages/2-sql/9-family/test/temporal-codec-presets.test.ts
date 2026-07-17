import { describe, expect, it } from 'vitest';
import {
  temporalAuthoringPresets,
  temporalCodecPreset,
  temporalCodecPresetWithPrecision,
} from '../src/core/timestamp-now-generator';

const TIMESTAMP_NOW_PHASE = { kind: 'generator', id: 'timestampNow' };

describe('temporalCodecPresetWithPrecision', () => {
  const preset = temporalCodecPresetWithPrecision({
    codecId: 'pg/timestamp@1',
    nativeType: 'timestamp',
  });

  it('declares precision, onCreate, onUpdate args in that order, all optional', () => {
    expect(preset.args).toEqual([
      { name: 'precision', kind: 'number', optional: true, integer: true, minimum: 0 },
      { name: 'onCreate', kind: 'option', values: ['now'], optional: true },
      { name: 'onUpdate', kind: 'option', values: ['now'], optional: true },
    ]);
  });

  it('maps the precision arg into typeParams and each phase token to the timestampNow generator', () => {
    expect(preset.output).toEqual({
      codecId: 'pg/timestamp@1',
      nativeType: 'timestamp',
      typeParams: { precision: { kind: 'arg', index: 0 } },
      executionDefaults: {
        onCreate: { kind: 'arg', index: 1, map: { now: TIMESTAMP_NOW_PHASE } },
        onUpdate: { kind: 'arg', index: 2, map: { now: TIMESTAMP_NOW_PHASE } },
      },
    });
  });

  it('carries the caller-supplied codec and native type', () => {
    expect(
      temporalCodecPresetWithPrecision({
        codecId: 'pg/timestamptz@1',
        nativeType: 'timestamptz',
      }).output,
    ).toMatchObject({ codecId: 'pg/timestamptz@1', nativeType: 'timestamptz' });
  });

  it('declares neither id nor unique, so it takes the plain helper path', () => {
    expect(preset.output).not.toHaveProperty('id');
    expect(preset.output).not.toHaveProperty('unique');
  });
});

describe('temporalCodecPreset', () => {
  const preset = temporalCodecPreset({ codecId: 'sqlite/datetime@1', nativeType: 'text' });

  it('declares only onCreate and onUpdate args, both optional', () => {
    expect(preset.args).toEqual([
      { name: 'onCreate', kind: 'option', values: ['now'], optional: true },
      { name: 'onUpdate', kind: 'option', values: ['now'], optional: true },
    ]);
  });

  it('omits typeParams and maps each phase token to the timestampNow generator', () => {
    expect(preset.output).toEqual({
      codecId: 'sqlite/datetime@1',
      nativeType: 'text',
      executionDefaults: {
        onCreate: { kind: 'arg', index: 0, map: { now: TIMESTAMP_NOW_PHASE } },
        onUpdate: { kind: 'arg', index: 1, map: { now: TIMESTAMP_NOW_PHASE } },
      },
    });
  });
});

describe('temporalAuthoringPresets', () => {
  it('is unchanged by the per-codec preset factories', () => {
    expect(
      temporalAuthoringPresets({ codecId: 'pg/timestamptz@1', nativeType: 'timestamptz' }),
    ).toEqual({
      createdAt: {
        kind: 'fieldPreset',
        output: {
          codecId: 'pg/timestamptz@1',
          nativeType: 'timestamptz',
          default: { kind: 'function', expression: 'now()' },
        },
      },
      updatedAt: {
        kind: 'fieldPreset',
        output: {
          codecId: 'pg/timestamptz@1',
          nativeType: 'timestamptz',
          executionDefaults: { onCreate: TIMESTAMP_NOW_PHASE, onUpdate: TIMESTAMP_NOW_PHASE },
        },
      },
    });
  });
});
