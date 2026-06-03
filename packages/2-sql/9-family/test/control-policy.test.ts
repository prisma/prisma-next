import { type Contract, coreHash, profileHash } from '@prisma-next/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import {
  buildSqlNamespace,
  SqlStorage,
  type StorageTableInput,
} from '@prisma-next/sql-contract/types';
import { applicationDomainOf } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import {
  type ControlPolicySubject,
  filterCallsByControlPolicy,
  partitionCallsByControlPolicy,
  partitionIssuesByControlPolicy,
} from '../src/core/migrations/control-policy';

function makeContract(
  tables: Record<string, StorageTableInput>,
  defaultControlPolicy?: Contract<SqlStorage>['defaultControlPolicy'],
): Contract<SqlStorage> {
  const storage = new SqlStorage({
    storageHash: coreHash('sha256:test'),
    namespaces: {
      [UNBOUND_NAMESPACE_ID]: buildSqlNamespace({ id: UNBOUND_NAMESPACE_ID, tables }),
    },
  });
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('sha256:test'),
    storage,
    domain: applicationDomainOf({ models: {} }),
    roots: {},
    capabilities: {},
    extensionPacks: {},
    meta: {},
    ...(defaultControlPolicy !== undefined ? { defaultControlPolicy } : {}),
  };
}

interface FakeCall {
  readonly name: string;
  readonly subject: ControlPolicySubject | undefined;
}

function call(name: string, subject: ControlPolicySubject | undefined): FakeCall {
  return { name, subject };
}

function tableSubject(
  policy: ControlPolicySubject['explicitNodeControlPolicy'] | undefined,
  createsNewObject: boolean,
): ControlPolicySubject {
  return {
    namespaceId: UNBOUND_NAMESPACE_ID,
    table: 'users',
    createsNewObject,
    ...(policy !== undefined ? { explicitNodeControlPolicy: policy } : {}),
  };
}

function filter(calls: readonly FakeCall[], contract: Contract<SqlStorage>): readonly FakeCall[] {
  return filterCallsByControlPolicy({
    calls,
    contract,
    resolveControlPolicySubject: (c) => c.subject,
  });
}

const tableInput: StorageTableInput = { columns: {}, uniques: [], indexes: [], foreignKeys: [] };

describe('filterCallsByControlPolicy', () => {
  describe('managed', () => {
    it('keeps every call, creation or modification', () => {
      const contract = makeContract({ users: { control: 'managed', ...tableInput } });
      const kept = filter(
        [
          call('createTable', tableSubject('managed', true)),
          call('dropTable', tableSubject('managed', false)),
          call('addColumn', tableSubject('managed', false)),
        ],
        contract,
      );
      expect(kept).toHaveLength(3);
    });

    it('keeps an unresolved-subject call', () => {
      const contract = makeContract({ users: tableInput });
      const kept = filter([call('createExtension', undefined)], contract);
      expect(kept).toHaveLength(1);
    });
  });

  describe('tolerated', () => {
    const contract = makeContract({ users: { control: 'tolerated', ...tableInput } });

    it('keeps a whole-object creation', () => {
      const kept = filter([call('createTable', tableSubject('tolerated', true))], contract);
      expect(kept.map((c) => c.name)).toEqual(['createTable']);
    });

    it('drops modifications of an existing object (no add column, index, alter, drop)', () => {
      const kept = filter(
        [
          call('addColumn', tableSubject('tolerated', false)),
          call('createIndex', tableSubject('tolerated', false)),
          call('alterColumnType', tableSubject('tolerated', false)),
          call('dropTable', tableSubject('tolerated', false)),
        ],
        contract,
      );
      expect(kept).toHaveLength(0);
    });

    it('drops an unresolved-subject call (not provably object-creation)', () => {
      const toleratedDefault = makeContract({ users: tableInput }, 'tolerated');
      const kept = filter([call('createExtension', undefined)], toleratedDefault);
      expect(kept).toHaveLength(0);
    });
  });

  describe('external and observed', () => {
    it('drops every call for an external or observed node', () => {
      for (const policy of ['external', 'observed'] as const) {
        const contract = makeContract({ users: { control: policy, ...tableInput } });
        const kept = filter(
          [
            call('createTable', tableSubject(policy, true)),
            call('dropTable', tableSubject(policy, false)),
          ],
          contract,
        );
        expect(kept).toHaveLength(0);
      }
    });

    it('observed default drops an unresolved-subject call', () => {
      const observedDefault = makeContract({ users: tableInput }, 'observed');
      const kept = filter([call('createExtension', undefined)], observedDefault);
      expect(kept).toHaveLength(0);
    });
  });

  describe('external floor', () => {
    const externalDefault = makeContract(
      { users: { control: 'managed', ...tableInput } },
      'external',
    );

    it('drops a managed-override creation (the floor wins)', () => {
      const kept = filter([call('createTable', tableSubject('managed', true))], externalDefault);
      expect(kept).toHaveLength(0);
    });

    it('drops an unresolved-subject call (fail-closed)', () => {
      const kept = filter([call('createExtension', undefined)], externalDefault);
      expect(kept).toHaveLength(0);
    });

    it('surfaces a controlPolicySuppressedCall warning for managed override under external default', () => {
      const { kept, warnings } = partitionCallsByControlPolicy({
        calls: [call('createTable', tableSubject('managed', true))],
        contract: externalDefault,
        resolveControlPolicySubject: (c) => c.subject,
        resolveFactoryName: (c) => c.name,
      });
      expect(kept).toHaveLength(0);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]?.kind).toBe('controlPolicySuppressedCall');
      expect(warnings[0]?.location).toMatchObject({
        namespace: UNBOUND_NAMESPACE_ID,
        table: 'users',
      });
      expect(warnings[0]?.meta).toMatchObject({
        controlPolicy: 'external',
        factoryName: 'createTable',
        declaredControlPolicy: 'managed',
      });
      expect(warnings[0]?.summary).toContain(
        "namespace '__unbound__' has effective control 'external' but table declared 'managed'",
      );
    });
  });
});

// Mirror of the call-side `partitionCallsByControlPolicy` test surface, but
// exercising the input-side issue-partitioning entry point that the SQL
// family planner pipeline now uses. The shapes are intentionally analogous —
// the post-condition each test pins is "this subject's issues never reach
// the planner; this many warnings are emitted instead".
interface FakeIssue {
  readonly kind: 'missing_table' | 'extra_table' | 'type_mismatch' | 'missing_column';
  readonly subject: ControlPolicySubject | undefined;
  /**
   * `'createTable'` for `missing_table`-style issues; `undefined` for the
   * non-creation kinds. The Postgres adapter encodes the same mapping in
   * `resolvePostgresIssueCreationFactoryName` based on the real
   * `SchemaIssue.kind`; these fakes call it out directly so the helper test
   * doesn't depend on adapter wiring.
   */
  readonly creationFactoryName: string | undefined;
}

function issue(
  kind: FakeIssue['kind'],
  subject: ControlPolicySubject | undefined,
  creationFactoryName: string | undefined,
): FakeIssue {
  return { kind, subject, creationFactoryName };
}

function partitionFake(issues: readonly FakeIssue[], contract: Contract<SqlStorage>) {
  return partitionIssuesByControlPolicy({
    issues,
    contract,
    resolveControlPolicySubject: (i) => i.subject,
    resolveCreationFactoryName: (i) => i.creationFactoryName,
  });
}

describe('partitionIssuesByControlPolicy', () => {
  describe('managed', () => {
    const contract = makeContract({ users: { control: 'managed', ...tableInput } });

    it('routes every issue into the plannable partition, creation or modification', () => {
      const { plannable, warnings } = partitionFake(
        [
          issue('missing_table', tableSubject('managed', true), 'createTable'),
          issue('extra_table', tableSubject('managed', false), undefined),
          issue('type_mismatch', tableSubject('managed', false), undefined),
        ],
        contract,
      );
      expect(plannable).toHaveLength(3);
      expect(warnings).toHaveLength(0);
    });
  });

  describe('tolerated', () => {
    const contract = makeContract({ users: { control: 'tolerated', ...tableInput } });

    it('routes a whole-object creation into the plannable partition', () => {
      const { plannable, warnings } = partitionFake(
        [issue('missing_table', tableSubject('tolerated', true), 'createTable')],
        contract,
      );
      expect(plannable.map((i) => i.kind)).toEqual(['missing_table']);
      expect(warnings).toHaveLength(0);
    });

    it('suppresses non-creation issues and consolidates to one warning per subject', () => {
      const { plannable, warnings } = partitionFake(
        [
          issue('missing_column', tableSubject('tolerated', false), undefined),
          issue('type_mismatch', tableSubject('tolerated', false), undefined),
        ],
        contract,
      );
      expect(plannable).toHaveLength(0);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]?.kind).toBe('controlPolicySuppressedCall');
      expect(warnings[0]?.meta).toMatchObject({
        controlPolicy: 'tolerated',
        factoryName: 'alterTable',
        declaredControlPolicy: 'tolerated',
      });
    });
  });

  describe('external and observed subjects never reach the planner', () => {
    it('drops every issue for an external or observed node and emits one warning per subject', () => {
      for (const policy of ['external', 'observed'] as const) {
        const contract = makeContract({ users: { control: policy, ...tableInput } });
        const { plannable, warnings } = partitionFake(
          [
            issue('missing_table', tableSubject(policy, true), 'createTable'),
            issue('extra_table', tableSubject(policy, false), undefined),
            issue('type_mismatch', tableSubject(policy, false), undefined),
          ],
          contract,
        );
        expect(plannable).toHaveLength(0);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]?.meta).toMatchObject({
          controlPolicy: policy,
          // creation issue won the race; the warning takes the creation factoryName
          factoryName: 'createTable',
        });
      }
    });

    it('falls back to alterTable when no creation issue is present', () => {
      const contract = makeContract({ users: { control: 'external', ...tableInput } });
      const { warnings } = partitionFake(
        [issue('type_mismatch', tableSubject('external', false), undefined)],
        contract,
      );
      expect(warnings).toHaveLength(1);
      expect(warnings[0]?.meta).toMatchObject({
        controlPolicy: 'external',
        factoryName: 'alterTable',
      });
    });
  });

  describe('external defaultControlPolicy floor', () => {
    const externalDefault = makeContract(
      { users: { control: 'managed', ...tableInput } },
      'external',
    );

    it('drops a managed-override missing-table issue and surfaces a suppressed-call warning', () => {
      const { plannable, warnings } = partitionFake(
        [issue('missing_table', tableSubject('managed', true), 'createTable')],
        externalDefault,
      );
      expect(plannable).toHaveLength(0);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]?.kind).toBe('controlPolicySuppressedCall');
      expect(warnings[0]?.location).toMatchObject({
        namespace: UNBOUND_NAMESPACE_ID,
        table: 'users',
      });
      expect(warnings[0]?.meta).toMatchObject({
        controlPolicy: 'external',
        factoryName: 'createTable',
        declaredControlPolicy: 'managed',
      });
      expect(warnings[0]?.summary).toContain(
        "namespace '__unbound__' has effective control 'external' but table declared 'managed'",
      );
    });
  });
});
