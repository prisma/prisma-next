import type {
  ExtensionPackRef,
  FamilyPackRef,
  TargetPackRef,
} from '@prisma-next/framework-components/components';
import { describe, expectTypeOf, it } from 'vitest';
import { defineContract, field, model } from '../src/contract-builder';
import type {
  ExtractIndexTypesFromPack,
  IndexTypesFromDefinition,
  MergeExtensionIndexTypes,
} from '../src/contract-types';

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

type DemoIndexTypes = {
  readonly demo: { readonly options: { readonly fillfactor: number } };
};

type AnalyticsIndexTypes = {
  readonly analytics: { readonly options: { readonly bucket: string } };
};

type DemoPack = ExtensionPackRef<'sql', 'postgres'> & {
  readonly __indexTypes?: DemoIndexTypes;
};

type AnalyticsPack = ExtensionPackRef<'sql', 'postgres'> & {
  readonly __indexTypes?: AnalyticsIndexTypes;
};

const demoPack: DemoPack = {
  kind: 'extension',
  id: 'demo',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
};

const analyticsPack: AnalyticsPack = {
  kind: 'extension',
  id: 'analytics',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
};

const int4Column = columnDescriptor('pg/int4@1');

describe('index-type pack threading', () => {
  it('ExtractIndexTypesFromPack pulls __indexTypes off a pack', () => {
    expectTypeOf<ExtractIndexTypesFromPack<DemoPack>>().toEqualTypeOf<DemoIndexTypes>();
  });

  it('ExtractIndexTypesFromPack returns an empty record for packs without __indexTypes', () => {
    type PlainPack = ExtensionPackRef<'sql', 'postgres'>;
    expectTypeOf<ExtractIndexTypesFromPack<PlainPack>>().toEqualTypeOf<Record<never, never>>();
  });

  it('MergeExtensionIndexTypes intersects across multiple packs', () => {
    type ExtractedDemo = ExtractIndexTypesFromPack<DemoPack>;
    type ExtractedAnalytics = ExtractIndexTypesFromPack<AnalyticsPack>;
    expectTypeOf<ExtractedDemo>().toEqualTypeOf<DemoIndexTypes>();
    expectTypeOf<ExtractedAnalytics>().toEqualTypeOf<AnalyticsIndexTypes>();
    type Merged = MergeExtensionIndexTypes<{
      demo: DemoPack;
      analytics: AnalyticsPack;
    }>;
    type DemoOptions = Merged['demo']['options'];
    type AnalyticsOptions = Merged['analytics']['options'];
    expectTypeOf<DemoOptions>().toEqualTypeOf<{ readonly fillfactor: number }>();
    expectTypeOf<AnalyticsOptions>().toEqualTypeOf<{ readonly bucket: string }>();
  });

  it('IndexTypesFromDefinition merges target + extension packs', () => {
    type Definition = {
      readonly target: TargetPackRef<'sql', 'postgres'>;
      readonly extensionPacks: { readonly demo: DemoPack; readonly analytics: AnalyticsPack };
    };
    type Resolved = IndexTypesFromDefinition<Definition>;
    type DemoOptions = Resolved['demo']['options'];
    type AnalyticsOptions = Resolved['analytics']['options'];
    expectTypeOf<DemoOptions>().toEqualTypeOf<{ readonly fillfactor: number }>();
    expectTypeOf<AnalyticsOptions>().toEqualTypeOf<{ readonly bucket: string }>();
  });

  it('IndexTypesFromDefinition is an empty record when no packs contribute', () => {
    type Definition = { readonly target: TargetPackRef<'sql', 'postgres'> };
    type Resolved = IndexTypesFromDefinition<Definition>;
    expectTypeOf<Resolved>().toEqualTypeOf<Record<never, never>>();
  });

  it('SqlContractResult exposes __indexTypes carrying the merged map', () => {
    const contract = defineContract({
      family: bareFamilyPack,
      target: postgresTargetPack,
      extensionPacks: { demo: demoPack, analytics: analyticsPack },
      models: {
        User: model('User', {
          fields: {
            id: field.column(int4Column).id(),
          },
        }).sql({ table: 'user' }),
      },
    });

    type Carried = NonNullable<typeof contract.__indexTypes>;
    expectTypeOf<Carried['demo']['options']>().toEqualTypeOf<{ readonly fillfactor: number }>();
    expectTypeOf<Carried['analytics']['options']>().toEqualTypeOf<{ readonly bucket: string }>();
  });

  it('SqlContractResult __indexTypes is empty when no packs contribute', () => {
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

    type Carried = NonNullable<typeof contract.__indexTypes>;
    expectTypeOf<Carried>().toEqualTypeOf<Record<never, never>>();
  });
});
