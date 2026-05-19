import { type } from 'arktype';

const requiredString = type('string').to('string > 0');
const optionalString = type('string | null');
const stringArray = type('string[]');

export const eventPayloadSchema = type({
  installationId: requiredString,
  version: requiredString,
  command: requiredString,
  runtimeName: requiredString,
  runtimeVersion: requiredString,
  os: requiredString,
  arch: requiredString,
  flags: stringArray.default(() => []),
  packageManager: optionalString.default(null),
  databaseTarget: optionalString.default(null),
  tsVersion: optionalString.default(null),
  agent: optionalString.default(null),
  extensions: stringArray.default(() => []),
  '+': 'delete',
});

export type EventPayload = typeof eventPayloadSchema.infer;
