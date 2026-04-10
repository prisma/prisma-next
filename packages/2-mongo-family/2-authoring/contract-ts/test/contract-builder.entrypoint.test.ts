import type {
  ExtensionPackRef,
  FamilyPackRef,
  TargetPackRef,
} from '@prisma-next/framework-components/components';
import { describe, expect, it } from 'vitest';
import { defineContract } from '../src/contract-builder';

const mongoFamilyPack = {
  kind: 'family',
  id: 'mongo',
  familyId: 'mongo',
  version: '0.0.1',
} as const satisfies FamilyPackRef<'mongo'>;

const sqlFamilyPack = {
  kind: 'family',
  id: 'sql',
  familyId: 'sql',
  version: '0.0.1',
} as const satisfies FamilyPackRef<'sql'>;

const mongoTargetPack = {
  kind: 'target',
  id: 'mongo',
  familyId: 'mongo',
  targetId: 'mongo',
  version: '0.0.1',
} as const satisfies TargetPackRef<'mongo', 'mongo'>;

const vectorExtensionPack = {
  kind: 'extension',
  id: 'vector-search',
  familyId: 'mongo',
  targetId: 'mongo',
  version: '0.0.1',
} as const satisfies ExtensionPackRef<'mongo', 'mongo'>;

function unsafeExtensionPackRefForRuntimeTest<FamilyId extends string, TargetId extends string>(
  pack: FamilyPackRef<string> | TargetPackRef<string, string> | ExtensionPackRef<string, string>,
): ExtensionPackRef<FamilyId, TargetId> {
  return pack as unknown as ExtensionPackRef<FamilyId, TargetId>;
}

describe('defineContract runtime guards', () => {
  it.each([
    {
      name: 'non-Mongo family packs',
      run: () =>
        defineContract({
          family: sqlFamilyPack,
          target: mongoTargetPack,
          models: {},
        }),
      error: 'defineContract only accepts Mongo family packs. Received family "sql".',
    },
    {
      name: 'non-extension pack refs in extensionPacks',
      run: () =>
        defineContract({
          family: mongoFamilyPack,
          target: mongoTargetPack,
          extensionPacks: {
            invalid: unsafeExtensionPackRefForRuntimeTest(mongoTargetPack),
          },
          models: {},
        }),
      error:
        'defineContract only accepts extension pack refs in extensionPacks. Received kind "target".',
    },
    {
      name: 'extension packs from another family',
      run: () =>
        defineContract({
          family: mongoFamilyPack,
          target: mongoTargetPack,
          extensionPacks: {
            invalid: unsafeExtensionPackRefForRuntimeTest({
              ...vectorExtensionPack,
              familyId: 'sql',
            }),
          },
          models: {},
        }),
      error:
        'extension pack "vector-search" targets family "sql" but contract target family is "mongo".',
    },
    {
      name: 'extension packs for another target',
      run: () =>
        defineContract({
          family: mongoFamilyPack,
          target: mongoTargetPack,
          extensionPacks: {
            invalid: {
              ...vectorExtensionPack,
              targetId: 'atlas',
            },
          },
          models: {},
        }),
      error: 'extension pack "vector-search" targets "atlas" but contract target is "mongo".',
    },
  ])('rejects $name', ({ run, error }) => {
    expect(run).toThrow(error);
  });
});
