import { describe, expect, it } from 'vitest';
import sqlFamilyPack from '../src/exports/pack';

describe('sql family pack authoring contributions', () => {
  it('exposes a family-owned sql.String type constructor', () => {
    expect(sqlFamilyPack.authoring?.type).toMatchObject({
      sql: {
        String: {
          kind: 'typeConstructor',
          args: [{ kind: 'number', name: 'length', integer: true, minimum: 1 }],
          output: {
            codecId: 'sql/varchar@1',
            nativeType: 'character varying',
            typeParams: {
              length: {
                kind: 'arg',
                index: 0,
              },
            },
          },
        },
      },
    });
  });
});
