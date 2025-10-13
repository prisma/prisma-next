import { describe, it, expect } from 'vitest';
import { emitContract } from '../src/ir-emitter';
import { SchemaAST, ModelDeclaration, FieldDeclaration } from '@prisma/psl';

describe('IR Emitter', () => {
  it('emits models alongside tables', async () => {
    const ast: SchemaAST = {
      type: 'Schema',
      models: [
        {
          type: 'ModelDeclaration',
          name: 'User',
          fields: [
            {
              type: 'FieldDeclaration',
              name: 'id',
              fieldType: 'Int',
              attributes: [
                { type: 'AttributeDeclaration', name: 'id' },
                {
                  type: 'AttributeDeclaration',
                  name: 'default',
                  args: [{ type: 'AttributeArgument', value: 'autoincrement' }],
                },
              ],
            },
            {
              type: 'FieldDeclaration',
              name: 'email',
              fieldType: 'String',
              attributes: [{ type: 'AttributeDeclaration', name: 'unique' }],
            },
          ],
        },
      ],
    };

    const result = await emitContract(ast);

    expect(result.models).toBeDefined();
    expect(result.models?.User).toBeDefined();
    expect(result.models?.User.name).toBe('User');
    expect(result.models?.User.storage.kind).toBe('table');
    expect(result.models?.User.storage.target).toBe('user');
  });

  it('emits scalar fields with correct mappings', async () => {
    const ast: SchemaAST = {
      type: 'Schema',
      models: [
        {
          type: 'ModelDeclaration',
          name: 'User',
          fields: [
            {
              type: 'FieldDeclaration',
              name: 'id',
              fieldType: 'Int',
              attributes: [],
            },
            {
              type: 'FieldDeclaration',
              name: 'email',
              fieldType: 'String',
              attributes: [],
            },
            {
              type: 'FieldDeclaration',
              name: 'bio',
              fieldType: 'String',
              attributes: [{ type: 'AttributeDeclaration', name: 'optional' }],
            },
          ],
        },
      ],
    };

    const result = await emitContract(ast);

    const userModel = result.models?.User;
    expect(userModel).toBeDefined();

    // Check scalar fields
    expect(userModel?.fields.id).toEqual({
      type: 'Int',
      isOptional: false,
      mappedTo: 'id',
    });

    expect(userModel?.fields.email).toEqual({
      type: 'String',
      isOptional: false,
      mappedTo: 'email',
    });

    expect(userModel?.fields.bio).toEqual({
      type: 'String',
      isOptional: true,
      mappedTo: 'bio',
    });
  });

  it('emits relation fields correctly', async () => {
    const ast: SchemaAST = {
      type: 'Schema',
      models: [
        {
          type: 'ModelDeclaration',
          name: 'User',
          fields: [
            {
              type: 'FieldDeclaration',
              name: 'id',
              fieldType: 'Int',
              attributes: [{ type: 'AttributeDeclaration', name: 'id' }],
            },
            {
              type: 'FieldDeclaration',
              name: 'posts',
              fieldType: {
                type: 'RelationFieldType',
                targetModel: 'Post',
                isArray: true,
              },
              attributes: [],
            },
          ],
        },
        {
          type: 'ModelDeclaration',
          name: 'Post',
          fields: [
            {
              type: 'FieldDeclaration',
              name: 'id',
              fieldType: 'Int',
              attributes: [{ type: 'AttributeDeclaration', name: 'id' }],
            },
            {
              type: 'FieldDeclaration',
              name: 'user',
              fieldType: {
                type: 'RelationFieldType',
                targetModel: 'User',
                isArray: false,
              },
              attributes: [],
            },
          ],
        },
      ],
    };

    const result = await emitContract(ast);

    const userModel = result.models?.User;
    const postModel = result.models?.Post;

    expect(userModel?.fields.posts).toEqual({
      type: 'Post',
      isList: true,
      isRelation: true,
      relationTarget: 'Post',
    });

    expect(postModel?.fields.user).toEqual({
      type: 'User',
      isList: false,
      isRelation: true,
      relationTarget: 'User',
    });
  });

  it('includes meta information in models', async () => {
    const ast: SchemaAST = {
      type: 'Schema',
      models: [
        {
          type: 'ModelDeclaration',
          name: 'User',
          fields: [
            {
              type: 'FieldDeclaration',
              name: 'id',
              fieldType: 'Int',
              attributes: [{ type: 'AttributeDeclaration', name: 'id' }],
            },
          ],
        },
      ],
    };

    const result = await emitContract(ast);

    const userModel = result.models?.User;
    expect(userModel?.meta?.source).toBe('model User');
  });

  it('maintains backward compatibility with existing tables', async () => {
    const ast: SchemaAST = {
      type: 'Schema',
      models: [
        {
          type: 'ModelDeclaration',
          name: 'User',
          fields: [
            {
              type: 'FieldDeclaration',
              name: 'id',
              fieldType: 'Int',
              attributes: [
                { type: 'AttributeDeclaration', name: 'id' },
                {
                  type: 'AttributeDeclaration',
                  name: 'default',
                  args: [{ type: 'AttributeArgument', value: 'autoincrement' }],
                },
              ],
            },
            {
              type: 'FieldDeclaration',
              name: 'email',
              fieldType: 'String',
              attributes: [{ type: 'AttributeDeclaration', name: 'unique' }],
            },
          ],
        },
      ],
    };

    const result = await emitContract(ast);

    // Tables should still be generated as before
    expect(result.tables).toBeDefined();
    expect(result.tables.user).toBeDefined();
    expect(result.tables.user.columns.id).toBeDefined();
    expect(result.tables.user.columns.email).toBeDefined();

    // Models should be additional
    expect(result.models).toBeDefined();
    expect(result.models?.User).toBeDefined();
  });

  it('excludes models from contract hash', async () => {
    const ast: SchemaAST = {
      type: 'Schema',
      models: [
        {
          type: 'ModelDeclaration',
          name: 'User',
          fields: [
            {
              type: 'FieldDeclaration',
              name: 'id',
              fieldType: 'Int',
              attributes: [{ type: 'AttributeDeclaration', name: 'id' }],
            },
          ],
        },
      ],
    };

    const result1 = await emitContract(ast);

    // Create a second AST with the same table structure but different model metadata
    const result2 = await emitContract({
      type: 'Schema',
      models: [
        {
          type: 'ModelDeclaration',
          name: 'User',
          fields: [
            {
              type: 'FieldDeclaration',
              name: 'id',
              fieldType: 'Int',
              attributes: [{ type: 'AttributeDeclaration', name: 'id' }],
            },
            // Add a relation field that doesn't affect table structure
            {
              type: 'FieldDeclaration',
              name: 'posts',
              fieldType: {
                type: 'RelationFieldType',
                targetModel: 'Post',
                isArray: true,
              },
              attributes: [],
            },
          ],
        },
      ],
    });

    // Hash should remain the same even though models changed
    expect(result1.contractHash).toBe(result2.contractHash);
  });
});
