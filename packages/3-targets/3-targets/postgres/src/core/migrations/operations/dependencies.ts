import { quoteIdentifier } from '@prisma-next/adapter-postgres/control';
import { type Op, step } from './shared';

export function createExtension(extensionName: string): Op {
  return {
    id: `extension.${extensionName}`,
    label: `Create extension "${extensionName}"`,
    operationClass: 'additive',
    target: { id: 'postgres' },
    precheck: [],
    execute: [
      step(
        `Create extension "${extensionName}"`,
        `CREATE EXTENSION IF NOT EXISTS ${quoteIdentifier(extensionName)}`,
      ),
    ],
    postcheck: [],
  };
}

export function createSchema(schemaName: string): Op {
  return {
    id: `schema.${schemaName}`,
    label: `Create schema "${schemaName}"`,
    operationClass: 'additive',
    target: { id: 'postgres' },
    precheck: [],
    execute: [
      step(
        `Create schema "${schemaName}"`,
        `CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(schemaName)}`,
      ),
    ],
    postcheck: [],
  };
}
