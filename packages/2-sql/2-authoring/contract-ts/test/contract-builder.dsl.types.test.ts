import type { FamilyPackRef, TargetPackRef } from '@prisma-next/framework-components/components';
import type {
  ExtractFieldInputTypes,
  ExtractFieldOutputTypes,
} from '@prisma-next/sql-contract/types';
import { describe, expectTypeOf, it } from 'vitest';
import { defineContract, field, model } from '../src/contract-builder';

import { columnDescriptor } from './helpers/column-descriptor';

const bareFamilyPack: FamilyPackRef<'sql'> = {
  kind: 'family',
  id: 'sql',
  familyId: 'sql',
  version: '0.0.1',
};

const postgresTargetPack: TargetPackRef<'sql', 'postgres'> = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
};

type AsyncCodecTypes = {
  readonly 'test/encrypted@1': {
    readonly input: string;
    readonly output: Promise<string>;
  };
};

// Output-only type map — mirrors what a hand-written third-party contract
// pack might ship: it declares `output` but omits `input`, forcing the
// ORM/contract type machinery to fall through to its default input derivation.
type OutputOnlyCodecTypes = {
  readonly 'test/encrypted@1': {
    readonly output: Promise<string>;
  };
};

const asyncTargetPackBase = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
} as const;

const asyncTargetPack: typeof asyncTargetPackBase & {
  readonly __codecTypes?: AsyncCodecTypes;
} = asyncTargetPackBase;

const outputOnlyAsyncTargetPack: typeof asyncTargetPackBase & {
  readonly __codecTypes?: OutputOnlyCodecTypes;
} = asyncTargetPackBase;

const int4Column = columnDescriptor('pg/int4@1');
const encryptedColumn = columnDescriptor('test/encrypted@1', 'text');

describe('contract DSL type surface', () => {
  it('preserves the typed contract result at the defineContract boundary', () => {
    const contract = defineContract({
      family: bareFamilyPack,
      target: postgresTargetPack,
      models: {
        User: model('User', {
          fields: {
            id: field.column(int4Column).id(),
          },
        }).sql({ table: 'user' }),
      },
    });

    expectTypeOf(contract.target).toEqualTypeOf<'postgres'>();
    expectTypeOf(contract.targetFamily).toEqualTypeOf<'sql'>();
    expectTypeOf(contract.models.User.storage.table).toEqualTypeOf<'user'>();
  });

  it('emits distinct input and output type maps for async codecs in no-emit contracts', () => {
    const contract = defineContract({
      family: bareFamilyPack,
      target: asyncTargetPack,
      models: {
        Secret: model('Secret', {
          fields: {
            value: field.column(encryptedColumn),
          },
        }).sql({ table: 'secret' }),
      },
    });

    expectTypeOf<ExtractFieldOutputTypes<typeof contract>['Secret']['value']>().toEqualTypeOf<
      Promise<string>
    >();
    expectTypeOf<
      ExtractFieldInputTypes<typeof contract>['Secret']['value']
    >().toEqualTypeOf<string>();
  });

  it('strips Promise wrapping from the input-type fallback when codec types expose only `output`', () => {
    const contract = defineContract({
      family: bareFamilyPack,
      target: outputOnlyAsyncTargetPack,
      models: {
        Secret: model('Secret', {
          fields: {
            value: field.column(encryptedColumn),
          },
        }).sql({ table: 'secret' }),
      },
    });

    expectTypeOf<ExtractFieldOutputTypes<typeof contract>['Secret']['value']>().toEqualTypeOf<
      Promise<string>
    >();
    // Fallback arm produces `Awaited<Promise<string>>` instead of `Promise<string>`.
    expectTypeOf<
      ExtractFieldInputTypes<typeof contract>['Secret']['value']
    >().toEqualTypeOf<string>();
  });
});
