import type { ProfileHashBase, StorageHashBase } from '@prisma-next/contract/types';
import type { MongoContractWithTypeMaps, MongoTypeMaps } from '@prisma-next/mongo-contract';
import { expectTypeOf, test } from 'vitest';
import type { CreateInput, DefaultModelRow } from '../src/types';

type TestCodecTypes = {
  readonly 'mongo/objectId@1': { readonly input: string; readonly output: string };
  readonly 'mongo/string@1': { readonly input: string; readonly output: string };
};

type TestTypeMaps = MongoTypeMaps<TestCodecTypes>;

type VOContract = MongoContractWithTypeMaps<
  {
    readonly target: 'mongo';
    readonly targetFamily: 'mongo';
    readonly profileHash: ProfileHashBase<'sha256:test'>;
    readonly capabilities: Record<string, never>;
    readonly extensionPacks: Record<string, never>;
    readonly meta: Record<string, never>;
    readonly roots: { readonly users: 'User' };
    readonly models: {
      readonly User: {
        readonly fields: {
          readonly _id: {
            readonly nullable: false;
            readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/objectId@1' };
          };
          readonly name: {
            readonly nullable: false;
            readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
          };
          readonly contactInfo: {
            readonly nullable: true;
            readonly type: { readonly kind: 'valueObject'; readonly name: 'ContactInfo' };
          };
          readonly tags: {
            readonly nullable: false;
            readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
            readonly many: true;
          };
        };
        readonly relations: Record<string, never>;
        readonly storage: { readonly collection: 'users' };
      };
    };
    readonly valueObjects: {
      readonly ContactInfo: {
        readonly fields: {
          readonly phone: {
            readonly nullable: false;
            readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
          };
          readonly website: {
            readonly nullable: true;
            readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
          };
        };
      };
    };
    readonly storage: {
      readonly collections: { readonly users: Record<string, never> };
      readonly storageHash: StorageHashBase<'sha256:test-storage'>;
    };
  },
  TestTypeMaps
>;

type ContactInfoShape = { phone: string; website: string | null };

test('DefaultModelRow expands value object to inline structure', () => {
  type Row = DefaultModelRow<VOContract, 'User'>;
  expectTypeOf<Row['contactInfo']>().toEqualTypeOf<ContactInfoShape | null>();
});

test('DefaultModelRow handles scalar array fields', () => {
  type Row = DefaultModelRow<VOContract, 'User'>;
  expectTypeOf<Row['tags']>().toEqualTypeOf<string[]>();
});

test('CreateInput accepts inline value object structure', () => {
  type Input = CreateInput<VOContract, 'User'>;
  expectTypeOf<Input['contactInfo']>().toEqualTypeOf<ContactInfoShape | null>();
});

test('CreateInput accepts null for nullable value object field', () => {
  type Input = CreateInput<VOContract, 'User'>;
  const input: Input = {
    name: 'Alice',
    contactInfo: null,
    tags: [],
  };
  expectTypeOf(input).toExtend<Input>();
});

test('CreateInput accepts populated value object', () => {
  type Input = CreateInput<VOContract, 'User'>;
  const input: Input = {
    name: 'Alice',
    contactInfo: { phone: '555-1234', website: null },
    tags: ['admin'],
  };
  expectTypeOf(input).toExtend<Input>();
});

test('update input accepts wholesale value object replacement', () => {
  type UpdateInput = Partial<DefaultModelRow<VOContract, 'User'>>;
  const input: UpdateInput = {
    contactInfo: { phone: '555-9999', website: 'https://example.com' },
  };
  expectTypeOf(input).toExtend<UpdateInput>();
});

test('update input accepts null for nullable value object field', () => {
  type UpdateInput = Partial<DefaultModelRow<VOContract, 'User'>>;
  const input: UpdateInput = { contactInfo: null };
  expectTypeOf(input).toExtend<UpdateInput>();
});

// --- Contracts with FieldOutputTypes / FieldInputTypes ---

type FieldOutputTypesForUser = {
  readonly User: {
    readonly _id: string;
    readonly name: string;
    readonly contactInfo: { phone: string; website: string | null } | null;
    readonly tags: string[];
  };
};

type FieldInputTypesForUser = {
  readonly User: {
    readonly _id: string;
    readonly name: string;
    readonly contactInfo: { phone: string; website: string | null } | null;
    readonly tags: string[];
  };
};

type TypeMapsWithFieldTypes = MongoTypeMaps<
  TestCodecTypes,
  Record<string, never>,
  FieldOutputTypesForUser,
  FieldInputTypesForUser
>;

type VOContractWithFieldTypes = MongoContractWithTypeMaps<
  {
    readonly target: 'mongo';
    readonly targetFamily: 'mongo';
    readonly profileHash: ProfileHashBase<'sha256:test'>;
    readonly capabilities: Record<string, never>;
    readonly extensionPacks: Record<string, never>;
    readonly meta: Record<string, never>;
    readonly roots: { readonly users: 'User' };
    readonly models: {
      readonly User: {
        readonly fields: {
          readonly _id: {
            readonly nullable: false;
            readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/objectId@1' };
          };
          readonly name: {
            readonly nullable: false;
            readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
          };
          readonly contactInfo: {
            readonly nullable: true;
            readonly type: { readonly kind: 'valueObject'; readonly name: 'ContactInfo' };
          };
          readonly tags: {
            readonly nullable: false;
            readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
            readonly many: true;
          };
        };
        readonly relations: Record<string, never>;
        readonly storage: { readonly collection: 'users' };
      };
    };
    readonly valueObjects: {
      readonly ContactInfo: {
        readonly fields: {
          readonly phone: {
            readonly nullable: false;
            readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
          };
          readonly website: {
            readonly nullable: true;
            readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
          };
        };
      };
    };
    readonly storage: {
      readonly collections: { readonly users: Record<string, never> };
      readonly storageHash: StorageHashBase<'sha256:test-storage'>;
    };
  },
  TypeMapsWithFieldTypes
>;

test('DefaultModelRow resolves to primitives when FieldOutputTypes is present', () => {
  type Row = DefaultModelRow<VOContractWithFieldTypes, 'User'>;
  expectTypeOf<Row['_id']>().toEqualTypeOf<string>();
  expectTypeOf<Row['name']>().toEqualTypeOf<string>();
  expectTypeOf<Row['tags']>().toEqualTypeOf<string[]>();
  expectTypeOf<Row['contactInfo']>().toEqualTypeOf<ContactInfoShape | null>();
});

test('DefaultModelRow falls back to InferModelRow when FieldOutputTypes is absent', () => {
  type Row = DefaultModelRow<VOContract, 'User'>;
  expectTypeOf<Row['_id']>().toEqualTypeOf<string>();
  expectTypeOf<Row['name']>().toEqualTypeOf<string>();
});

test('CreateInput resolves via FieldInputTypes when present', () => {
  type Input = CreateInput<VOContractWithFieldTypes, 'User'>;
  expectTypeOf<Input['name']>().toEqualTypeOf<string>();
  expectTypeOf<Input['contactInfo']>().toEqualTypeOf<ContactInfoShape | null>();
});
