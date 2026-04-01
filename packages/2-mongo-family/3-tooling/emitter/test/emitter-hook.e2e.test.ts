import type { TypesImportSpec } from '@prisma-next/contract/types';
import { describe, expect, it } from 'vitest';
import { mongoTargetFamilyHook } from '../src/index';
import { blogContractIR } from './fixtures/blog-contract-ir';

const testHashes = { storageHash: 'sha256:blog-test', profileHash: 'sha256:blog-profile' };

const mongoCodecImports: TypesImportSpec[] = [
  {
    package: '@prisma-next/target-mongo/codec-types',
    named: 'CodecTypes',
    alias: 'MongoCodecTypes',
  },
];

describe('Mongo emitter hook end-to-end (blog fixture)', () => {
  it('validates the blog contract IR', () => {
    expect(() => mongoTargetFamilyHook.validateTypes(blogContractIR, {})).not.toThrow();
    expect(() => mongoTargetFamilyHook.validateStructure(blogContractIR)).not.toThrow();
  });

  it('generates complete contract.d.ts from blog IR', () => {
    const types = mongoTargetFamilyHook.generateContractTypes(
      blogContractIR,
      mongoCodecImports,
      [],
      testHashes,
    );

    expect(types).toContain(
      'export type Contract = MongoContractWithTypeMaps<ContractBase, TypeMaps>',
    );
    expect(types).toContain('export type TypeMaps = MongoTypeMaps<CodecTypes, OperationTypes>');
    expect(types).toContain('export type CodecTypes = MongoCodecTypes');

    expect(types).toContain("readonly users: 'User'");
    expect(types).toContain("readonly posts: 'Post'");

    expect(types).toContain('readonly User:');
    expect(types).toContain('readonly Post:');
    expect(types).toContain('readonly Comment:');

    expect(types).toContain(
      "readonly _id: { readonly codecId: 'mongo/objectId@1'; readonly nullable: false }",
    );
    expect(types).toContain(
      "readonly name: { readonly codecId: 'mongo/string@1'; readonly nullable: false }",
    );
    expect(types).toContain(
      "readonly bio: { readonly codecId: 'mongo/string@1'; readonly nullable: true }",
    );

    expect(types).toContain("readonly to: 'Post'");
    expect(types).toContain("readonly cardinality: '1:N'");
    expect(types).toContain("readonly localFields: readonly ['_id']");
    expect(types).toContain("readonly targetFields: readonly ['authorId']");

    expect(types).toContain("readonly owner: 'Post'");

    expect(types).toContain("readonly collection: 'users'");
    expect(types).toContain("readonly collection: 'posts'");

    expect(types).toContain(
      "readonly relations: { readonly comments: { readonly field: 'comments' } }",
    );

    expect(types).not.toContain('strategy');
  });

  it('generates storage section with collections', () => {
    const types = mongoTargetFamilyHook.generateContractTypes(blogContractIR, [], [], testHashes);

    expect(types).toContain('readonly collections:');
    expect(types).toContain('readonly users: Record<string, never>');
    expect(types).toContain('readonly posts: Record<string, never>');
  });

  it('generates Comment model with owner and empty storage', () => {
    const types = mongoTargetFamilyHook.generateContractTypes(blogContractIR, [], [], testHashes);

    expect(types).toContain(
      "readonly text: { readonly codecId: 'mongo/string@1'; readonly nullable: false }",
    );
    expect(types).toContain(
      "readonly createdAt: { readonly codecId: 'mongo/date@1'; readonly nullable: false }",
    );
    expect(types).toContain("readonly owner: 'Post'");
  });
});
