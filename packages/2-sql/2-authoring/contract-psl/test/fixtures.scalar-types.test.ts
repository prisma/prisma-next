import { collectScalarTypeConstructors } from '@prisma-next/framework-components/authoring';
import { describe, expect, it } from 'vitest';
import {
  postgresBaseScalarAuthoringTypes,
  postgresNativeScalarTypeDescriptors,
  postgresScalarAuthoringTypes,
  postgresScalarTypeDescriptors,
  sqliteScalarAuthoringTypes,
  sqliteScalarColumnDescriptors,
} from './fixtures';

describe('scalar type fixtures', () => {
  it('derives PostgreSQL base descriptors from the base authoring namespace', () => {
    expect(postgresScalarTypeDescriptors).toEqual(
      collectScalarTypeConstructors(postgresBaseScalarAuthoringTypes),
    );
  });

  it('derives PostgreSQL native descriptors from the complete authoring namespace', () => {
    expect(postgresNativeScalarTypeDescriptors).toEqual(
      collectScalarTypeConstructors(postgresScalarAuthoringTypes),
    );
  });

  it('derives SQLite descriptors from its authoring namespace', () => {
    expect(sqliteScalarColumnDescriptors).toEqual(
      collectScalarTypeConstructors(sqliteScalarAuthoringTypes),
    );
  });
});
