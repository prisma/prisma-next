import { expectTypeOf, test } from 'vitest';
import type { SchemaIssue } from '../src/control/control-result-types';

test('BaseSchemaIssue missing_table is a member of SchemaIssue', () => {
  type Kinds = SchemaIssue['kind'];
  expectTypeOf<'missing_table'>().toMatchTypeOf<Kinds>();
});

test('EnumValuesChangedIssue is assignable to SchemaIssue', () => {
  const issue = {
    kind: 'enum_values_changed' as const,
    namespaceId: 'ns',
    typeName: 'Status',
    addedValues: [],
    removedValues: [],
    message: 'Enum changed',
  };
  expectTypeOf(issue).toMatchTypeOf<SchemaIssue>();
});
