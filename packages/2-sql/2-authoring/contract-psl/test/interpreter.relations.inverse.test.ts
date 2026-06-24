import type { Contract } from '@prisma-next/contract/types';
import { crossRef } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { validateSqlContractFully } from '@prisma-next/sql-contract/validators';
import { describe, expect, it } from 'vitest';
import { interpretPslDocumentToSqlContract } from '../src/interpreter';
import {
  createBuiltinLikeControlMutationDefaults,
  modelsOf,
  postgresScalarTypeDescriptors,
  postgresTarget,
  symbolTableInputFromParseArgs,
} from './fixtures';

const baseInput = {
  target: postgresTarget,
  scalarTypeDescriptors: postgresScalarTypeDescriptors,
  controlMutationDefaults: createBuiltinLikeControlMutationDefaults(),
  composedExtensionContracts: new Map(),
} as const;

function interpret(schema: string) {
  const document = symbolTableInputFromParseArgs({ schema, sourceId: 'schema.prisma' });
  return interpretPslDocumentToSqlContract({ ...baseInput, ...document });
}

function relationsOf(contract: Contract) {
  return modelsOf(contract) as Record<string, { relations?: Record<string, unknown> }>;
}

const twoRelationPostModel = `model Post {
  id Int @id
  authorId Int
  editorId Int
  author User @relation(from: authorId)
  editor User @relation(from: editorId)
}
`;

describe('interpretPslDocumentToSqlContract inverse: one-to-many disambiguation', () => {
  it('pins each back-relation to the FK-side relation field it names', () => {
    const result = interpret(`model User {
  id Int @id
  authoredPosts Post[] @relation(inverse: author)
  editedPosts Post[] @relation(inverse: editor)
}

${twoRelationPostModel}`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const models = relationsOf(result.value);
    expect(models['User']?.relations).toEqual({
      authoredPosts: {
        to: crossRef('Post', 'public'),
        cardinality: '1:N',
        on: { localFields: ['id'], targetFields: ['authorId'] },
      },
      editedPosts: {
        to: crossRef('Post', 'public'),
        cardinality: '1:N',
        on: { localFields: ['id'], targetFields: ['editorId'] },
      },
    });
    expect(models['Post']?.relations).toEqual({
      author: {
        to: crossRef('User', 'public'),
        cardinality: 'N:1',
        on: { localFields: ['authorId'], targetFields: ['id'] },
      },
      editor: {
        to: crossRef('User', 'public'),
        cardinality: 'N:1',
        on: { localFields: ['editorId'], targetFields: ['id'] },
      },
    });

    const envelope = JSON.parse(JSON.stringify(result.value)) as unknown;
    expect(() => validateSqlContractFully<Contract<SqlStorage>>(envelope)).not.toThrow();
  });

  it('defers the same shape to the ambiguity diagnostic when inverse: is absent (control)', () => {
    const result = interpret(`model User {
  id Int @id
  authoredPosts Post[]
  editedPosts Post[]
}

${twoRelationPostModel}`);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_AMBIGUOUS_BACKRELATION_LIST',
          message: expect.stringContaining('User.authoredPosts'),
        }),
      ]),
    );
  });

  it('emits an actionable diagnostic when inverse: names a field that is not an FK-side relation', () => {
    const result = interpret(`model User {
  id Int @id
  authoredPosts Post[] @relation(inverse: notAField)
  editedPosts Post[] @relation(inverse: editor)
}

${twoRelationPostModel}`);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    const diagnostic = result.failure.diagnostics.find(
      (d) => d.code === 'PSL_INVERSE_FIELD_NOT_FK',
    );
    expect(diagnostic).toBeDefined();
    expect(diagnostic?.message).toContain('User.authoredPosts');
    expect(diagnostic?.message).toContain('notAField');
    expect(diagnostic?.message).toContain('Post');
  });

  it('still disambiguates a legacy name:-authored version to the same contract', () => {
    const viaInverse = interpret(`model User {
  id Int @id
  authoredPosts Post[] @relation(inverse: author)
  editedPosts Post[] @relation(inverse: editor)
}

${twoRelationPostModel}`);

    const viaName = interpret(`model User {
  id Int @id
  authoredPosts Post[] @relation(name: "AuthoredPosts")
  editedPosts Post[] @relation(name: "EditedPosts")
}

model Post {
  id Int @id
  authorId Int
  editorId Int
  author User @relation(name: "AuthoredPosts", from: authorId)
  editor User @relation(name: "EditedPosts", from: editorId)
}
`);

    expect(viaInverse.ok).toBe(true);
    expect(viaName.ok).toBe(true);
    if (!viaInverse.ok || !viaName.ok) return;

    const inverseRelations = relationsOf(viaInverse.value)['User']?.relations;
    const nameRelations = relationsOf(viaName.value)['User']?.relations;
    expect(inverseRelations).toEqual(nameRelations);
  });
});
