import type { TargetPackRef } from '@prisma-next/contract/framework-components';
import { describe, expect, it } from 'vitest';
import {
  applyNaming,
  field,
  isStagedContractInput,
  model,
  normalizeRelationFieldNames,
  rel,
  resolveRelationModelName,
} from '../src/staged-contract-dsl';
import { columnDescriptor } from './helpers/column-descriptor';

const postgresTargetPack: TargetPackRef<'sql', 'postgres'> = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
};

const int4Column = columnDescriptor('pg/int4@1');
const textColumn = columnDescriptor('pg/text@1');
const charColumn = columnDescriptor('sql/char@1', 'character');

describe('staged contract DSL runtime helpers', () => {
  it('normalizes defaults, generated descriptors, relation helpers, and staged-input detection', () => {
    const literalDefault = field.column(textColumn).default('draft').build();
    const functionDefault = field
      .column(textColumn)
      .default({ kind: 'function', expression: 'now()' })
      .build();
    const generated = field
      .generated({
        type: charColumn,
        typeParams: { length: 12 },
        generated: {
          kind: 'generator',
          id: 'nanoid',
          params: { size: 12 },
        },
      })
      .build();

    const User = model('User', {
      fields: {
        id: field.column(int4Column).id(),
      },
    });

    const lazyBelongsTo = rel.belongsTo(() => User, { from: 'id', to: 'id' }).build();

    expect(literalDefault.default).toEqual({ kind: 'literal', value: 'draft' });
    expect(functionDefault.default).toEqual({ kind: 'function', expression: 'now()' });
    expect(generated.descriptor).toEqual({
      codecId: 'sql/char@1',
      nativeType: 'character',
      typeParams: { length: 12 },
    });
    expect(normalizeRelationFieldNames('id')).toEqual(['id']);
    expect(normalizeRelationFieldNames(['orgId', 'userId'])).toEqual(['orgId', 'userId']);
    expect(resolveRelationModelName(lazyBelongsTo.toModel)).toBe('User');
    expect(applyNaming('HTTPRequestLog', 'snake_case')).toBe('http_request_log');
    expect(applyNaming('UserProfile', 'identity')).toBe('UserProfile');
    expect(isStagedContractInput({ target: postgresTargetPack })).toBe(true);
    expect(isStagedContractInput({ target: { kind: 'extension' } })).toBe(false);
    expect(isStagedContractInput(null)).toBe(false);
  });

  it('rejects runtime-only misuse of model tokens and relation sql helpers', () => {
    const Anonymous = model({
      fields: {
        id: field.column(int4Column),
      },
    });

    const hasMany = rel.hasMany('User', { by: 'userId' });

    expect(() =>
      Reflect.apply(Anonymous.ref as (...args: readonly unknown[]) => unknown, Anonymous, ['id']),
    ).toThrow('Model tokens require model("ModelName", ...) before calling .ref(...)');

    expect(() =>
      Reflect.apply(rel.belongsTo as (...args: readonly unknown[]) => unknown, rel, [
        Anonymous,
        { from: 'id', to: 'id' },
      ]),
    ).toThrow(
      'Relation targets require named model tokens. Use model("ModelName", ...) before passing a token to rel.*(...).',
    );

    expect(() => model('User', undefined as never)).toThrow(
      'model("ModelName", ...) requires a model definition.',
    );

    expect(() =>
      Reflect.apply(hasMany.sql as (...args: readonly unknown[]) => unknown, hasMany, [
        { fk: { name: 'post_user_id_fkey' } },
      ]),
    ).toThrow('relation.sql(...) is only supported for belongsTo relations.');
  });

  it('builds staged sql specs with explicit options and validates target refs eagerly', () => {
    const User = model('User', {
      fields: {
        id: field.column(int4Column).id(),
      },
    });

    const Team = model('Team', {
      fields: {
        id: field.column(int4Column).id(),
      },
    });

    const AuditLog = model('AuditLog', {
      fields: {
        userId: field.column(int4Column),
        teamId: field.column(int4Column),
      },
    }).sql(({ cols, constraints }) => ({
      indexes: [
        constraints.index(cols.teamId, {
          name: 'audit_log_team_id_idx',
          using: 'hash',
          config: { fillfactor: 70 },
        }),
      ],
      foreignKeys: [
        constraints.foreignKey([cols.userId], [User.refs['id']], {
          name: 'audit_log_user_id_fkey',
          onDelete: 'cascade',
          onUpdate: 'restrict',
          constraint: false,
          index: false,
        }),
      ],
    }));

    expect(AuditLog.buildSqlSpec()).toEqual({
      indexes: [
        {
          kind: 'index',
          fields: ['teamId'],
          name: 'audit_log_team_id_idx',
          using: 'hash',
          config: { fillfactor: 70 },
        },
      ],
      foreignKeys: [
        {
          kind: 'fk',
          fields: ['userId'],
          targetModel: 'User',
          targetFields: ['id'],
          targetSource: 'token',
          name: 'audit_log_user_id_fkey',
          onDelete: 'cascade',
          onUpdate: 'restrict',
          constraint: false,
          index: false,
        },
      ],
    });

    const emptyTargetRefs: readonly {
      readonly kind: 'targetFieldRef';
      readonly source: 'string';
      readonly modelName: string;
      readonly fieldName: string;
    }[] = [];

    const mixedTargetRefs: readonly {
      readonly kind: 'targetFieldRef';
      readonly source: 'string';
      readonly modelName: string;
      readonly fieldName: string;
    }[] = [User.ref('id'), Team.ref('id')];

    const BrokenEmpty = model('BrokenEmpty', {
      fields: {
        userId: field.column(int4Column),
      },
    }).sql(({ cols, constraints }) => ({
      foreignKeys: [constraints.foreignKey(cols.userId, emptyTargetRefs)],
    }));

    const BrokenMixed = model('BrokenMixed', {
      fields: {
        userId: field.column(int4Column),
        teamId: field.column(int4Column),
      },
    }).sql(({ cols, constraints }) => ({
      foreignKeys: [constraints.foreignKey([cols.userId, cols.teamId], mixedTargetRefs)],
    }));

    expect(() => BrokenEmpty.buildSqlSpec()).toThrow('Expected at least one target ref');
    expect(() => BrokenMixed.buildSqlSpec()).toThrow(
      'All target refs in a foreign key must point to the same model',
    );
  });
});
