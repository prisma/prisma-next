import type { Expand, ScopeField } from './scope';

/// Given a row type of { <fieldName>: { codecId: <codecId>, nullable: <nullable> } }, return a record of { <fieldName>: <codecOutputType> }
/// Also resolves nullability of the field.
export type ResolveRow<
  Row extends Record<string, ScopeField>,
  CodecTypes extends Record<string, { readonly output: unknown }>,
> = Expand<{
  -readonly [K in keyof Row]: Row[K]['codecId'] extends keyof CodecTypes
    ? Row[K]['nullable'] extends true
      ? CodecTypes[Row[K]['codecId']]['output'] | null
      : CodecTypes[Row[K]['codecId']]['output']
    : unknown;
}>;
