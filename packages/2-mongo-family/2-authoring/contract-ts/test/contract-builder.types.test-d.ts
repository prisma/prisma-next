import type { FamilyPackRef, TargetPackRef } from '@prisma-next/framework-components/components';
import type {
  InferModelRow,
  MongoCollectionOptionsAuthoringInput,
  MongoIndexOptionsInput,
  MongoModelsMap,
} from '@prisma-next/mongo-contract';
import { expectTypeOf, test } from 'vitest';
import { defineContract, field, index, model, valueObject } from '../src/contract-builder';
import { enumType, member } from '../src/enum-type';

const mongoFamilyPack = {
  kind: 'family',
  id: 'mongo',
  familyId: 'mongo',
  version: '0.0.1',
} as const satisfies FamilyPackRef<'mongo'>;

const mongoTargetPack = {
  kind: 'target',
  id: 'mongo',
  familyId: 'mongo',
  targetId: 'mongo',
  version: '0.0.1',
  defaultNamespaceId: '__unbound__',
} as const satisfies TargetPackRef<'mongo', 'mongo'>;

const Address = valueObject('Address', {
  fields: {
    street: field.string(),
    zip: field.string().optional(),
  },
});

const User = model('User', {
  collection: 'users',
  fields: {
    _id: field.objectId(),
    homeAddress: field.valueObject(Address).optional(),
    previousAddresses: field.valueObject(Address).many(),
  },
});

const contract = defineContract({
  family: mongoFamilyPack,
  target: mongoTargetPack,
  models: { User },
  valueObjects: { Address },
});

const Task = model('Task', {
  collection: 'tasks',
  fields: {
    _id: field.objectId(),
    type: field.string(),
  },
  discriminator: {
    field: 'type',
    variants: {
      Bug: { value: 'bug' },
      Feature: { value: 'feature' },
    },
  },
});

const Bug = model('Bug', {
  collection: 'tasks',
  base: Task,
  fields: {
    severity: field.string(),
  },
});

const Feature = model('Feature', {
  collection: 'tasks',
  base: Task,
  fields: {
    priority: field.string(),
  },
});

const polymorphicContract = defineContract({
  family: mongoFamilyPack,
  target: mongoTargetPack,
  models: { Task, Bug, Feature },
});

type UserRow = InferModelRow<typeof contract, 'User'>;

test('contract roots stay specific', () => {
  expectTypeOf(contract.roots.users.model).toEqualTypeOf<'User'>();
});

test('polymorphic variants keep literal model keys', () => {
  type VariantKeys = keyof NonNullable<
    MongoModelsMap<typeof polymorphicContract>['Task']['variants']
  >;

  expectTypeOf<VariantKeys>().toEqualTypeOf<'Bug' | 'Feature'>();
  type BugVariantValue = MongoModelsMap<
    typeof polymorphicContract
  >['Task']['variants']['Bug']['value'];
  expectTypeOf<BugVariantValue>().toBeString();
});

test('value object rows flow through InferModelRow', () => {
  expectTypeOf<UserRow['_id']>().toEqualTypeOf<string>();
  expectTypeOf<UserRow['homeAddress']>().toEqualTypeOf<{
    street: string;
    zip: string | null;
  } | null>();
  expectTypeOf<UserRow['previousAddresses']>().toEqualTypeOf<
    {
      street: string;
      zip: string | null;
    }[]
  >();
});

test('double helper infers numeric row values', () => {
  const Measurement = model('Measurement', {
    collection: 'measurements',
    fields: {
      _id: field.objectId(),
      reading: field.double(),
    },
  });

  const measurementContract = defineContract({
    family: mongoFamilyPack,
    target: mongoTargetPack,
    models: { Measurement },
  });

  type MeasurementRow = InferModelRow<typeof measurementContract, 'Measurement'>;

  expectTypeOf<MeasurementRow['reading']>().toEqualTypeOf<number>();
});

test('index helper preserves literal Mongo index authoring', () => {
  const uniqueEmailIndex = index({ email: 1 }, { unique: true });

  expectTypeOf(uniqueEmailIndex.fields.email).toEqualTypeOf<1>();
  expectTypeOf(uniqueEmailIndex.options.unique).toEqualTypeOf<true>();
});

test('index helper accepts typed Mongo index options', () => {
  const searchablePostIndex = index(
    { title: 'text', location: '2dsphere' },
    {
      name: 'post_search_idx',
      hidden: true,
      default_language: 'english',
      collation: { locale: 'en', strength: 2 },
      wildcardProjection: { internalNotes: 0, title: 1 },
    },
  );

  expectTypeOf(searchablePostIndex.options.name).toEqualTypeOf<'post_search_idx'>();
  expectTypeOf(searchablePostIndex.options.hidden).toEqualTypeOf<true>();
  expectTypeOf(searchablePostIndex.options.default_language).toEqualTypeOf<'english'>();
  expectTypeOf(searchablePostIndex.options.collation.locale).toEqualTypeOf<'en'>();
  expectTypeOf(searchablePostIndex.options.collation.strength).toEqualTypeOf<2>();
  expectTypeOf(searchablePostIndex.options.wildcardProjection.internalNotes).toEqualTypeOf<0>();
});

test('model authoring accepts typed Mongo collection options', () => {
  model('Event', {
    collection: 'events',
    fields: {
      _id: field.objectId(),
      createdAt: field.date(),
    },
    collectionOptions: {
      capped: true,
      size: 4096,
      expireAfterSeconds: 3600,
      collation: { locale: 'en', strength: 2 },
      timeseries: { timeField: 'createdAt', granularity: 'hours' },
      changeStreamPreAndPostImages: { enabled: true },
      clusteredIndex: {
        name: '_id_',
        key: { _id: 1 },
        unique: true,
      },
    },
  });
});

test('Mongo option types reject unsupported authoring shapes', () => {
  // @ts-expect-error unknown Mongo index option
  const _invalidIndexOptions = { unsupported: true } satisfies MongoIndexOptionsInput;
  _invalidIndexOptions;

  // @ts-expect-error expireAfterSeconds must be a number
  const _invalidTtlIndexOptions = { expireAfterSeconds: '3600' } satisfies MongoIndexOptionsInput;
  _invalidTtlIndexOptions;

  const _invalidCollectionOptionKey = {
    // @ts-expect-error unknown Mongo collection option
    unsupported: true,
  } satisfies MongoCollectionOptionsAuthoringInput;
  _invalidCollectionOptionKey;

  const _invalidCollectionOptionValue = {
    timeseries: {
      timeField: 'createdAt',
      // @ts-expect-error invalid timeseries granularity
      granularity: 'days',
    },
  } satisfies MongoCollectionOptionsAuthoringInput;
  _invalidCollectionOptionValue;
});

// ---------------------------------------------------------------------------
// F11: BuilderFieldOutputType nullable+many corner (operator precedence)
//
// Prior to the F11 fix, the nullable+many case produced (Base | null)[]
// (array-of-nullable) due to TS operator precedence (`extends` binds tighter
// than `|`). The fix composes Many first, then adds nullability, producing
// Base[] | null. This is the same corner exercised by the runtime asymmetry
// the slice already documents — the type-level mirror was silently wrong.
//
// Also adds the F14 enumType registration so the namespace enum? slot test
// verifies literal preservation through MongoDomainNamespaceFromDefinition.
// ---------------------------------------------------------------------------

const F11Role = enumType(
  'F11Role',
  { codecId: 'mongo/string@1', nativeType: 'string' },
  member('User', 'user'),
  member('Admin', 'admin'),
);

const F11Contract = defineContract({
  family: mongoFamilyPack,
  target: mongoTargetPack,
  enums: { F11Role },
  models: {
    F11Account: model('F11Account', {
      collection: 'f11_accounts',
      fields: {
        _id: field.objectId(),
        scalarField: field.string(),
        nullableField: field.string().optional(),
        manyField: field.string().many(),
        nullableManyField: field.string().optional().many(),
      },
    }),
  },
});

type F11Row = InferModelRow<typeof F11Contract, 'F11Account'>;

test('F11: scalar field resolves to codec base type', () => {
  expectTypeOf<F11Row['scalarField']>().toEqualTypeOf<string>();
});

test('F11: nullable field resolves to Base | null', () => {
  expectTypeOf<F11Row['nullableField']>().toEqualTypeOf<string | null>();
});

test('F11: many field resolves to Base[]', () => {
  expectTypeOf<F11Row['manyField']>().toEqualTypeOf<string[]>();
});

test('F11: nullable+many field resolves to Base[] | null, not (Base | null)[]', () => {
  // The precedence bug produced (string | null)[]; the fix produces string[] | null.
  expectTypeOf<F11Row['nullableManyField']>().toEqualTypeOf<string[] | null>();
  expectTypeOf<F11Row['nullableManyField']>().not.toEqualTypeOf<(string | null)[]>();
});

// ---------------------------------------------------------------------------
// F14: namespace enum? slot carries literal-preserving entries
// ---------------------------------------------------------------------------

test('F14: namespace enum slot is typed with literal value preservation', () => {
  type Ns = (typeof F11Contract)['domain']['namespaces']['__unbound__'];
  type RoleEntry = NonNullable<Ns['enum']>['F11Role'];
  type MemberValue = RoleEntry['members'][number]['value'];
  expectTypeOf<MemberValue>().toEqualTypeOf<'user' | 'admin'>();
});
