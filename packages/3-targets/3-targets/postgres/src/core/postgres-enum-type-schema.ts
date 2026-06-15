import { type } from 'arktype';

const ControlPolicySchema = type("'managed' | 'tolerated' | 'external' | 'observed'");

/**
 * Arktype validator for a `postgres-enum` entry under
 * `storage.namespaces[id].entries.type[name]`. Registered by the Postgres
 * target pack against the `'type'` entries key so the family-layer namespace
 * validator accepts (and rejects) entries of this kind.
 */
export const PostgresEnumTypeSchema = type({
  kind: "'postgres-enum'",
  'name?': 'string',
  'nativeType?': 'string',
  values: type.string.array().readonly(),
  'control?': ControlPolicySchema,
});
