import type { ContractField, ContractValueObject } from '@prisma-next/contract/types';
import type { TargetPackRef } from '@prisma-next/framework-components/components';
import { describe, expect, it } from 'vitest';
import { buildSqlContractFromDefinition } from '../src/contract-builder';

const postgresTargetPack: TargetPackRef<'sql', 'postgres'> = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
};

describe('value objects in contract definition builder', () => {
  it('emits valueObjects section with scalar fields', () => {
    const contract = buildSqlContractFromDefinition({
      target: postgresTargetPack,
      models: [
        {
          modelName: 'User',
          tableName: 'user',
          fields: [
            {
              fieldName: 'id',
              columnName: 'id',
              descriptor: { codecId: 'pg/int4@1', nativeType: 'int4' },
              nullable: false,
            },
          ],
          id: { columns: ['id'] },
        },
      ],
      valueObjects: [
        {
          name: 'Address',
          fields: [
            {
              fieldName: 'street',
              columnName: 'street',
              descriptor: { codecId: 'pg/text@1', nativeType: 'text' },
              nullable: false,
            },
            {
              fieldName: 'city',
              columnName: 'city',
              descriptor: { codecId: 'pg/text@1', nativeType: 'text' },
              nullable: false,
            },
          ],
        },
      ],
    });

    const valueObjects = contract.valueObjects as Record<string, ContractValueObject> | undefined;

    expect(valueObjects).toBeDefined();
    expect(valueObjects?.['Address']).toEqual({
      fields: {
        street: {
          type: { kind: 'scalar', codecId: 'pg/text@1' },
          nullable: false,
        },
        city: {
          type: { kind: 'scalar', codecId: 'pg/text@1' },
          nullable: false,
        },
      },
    });
  });

  it('emits valueObject domain type for model fields referencing a value object', () => {
    const contract = buildSqlContractFromDefinition({
      target: postgresTargetPack,
      models: [
        {
          modelName: 'User',
          tableName: 'user',
          fields: [
            {
              fieldName: 'id',
              columnName: 'id',
              descriptor: { codecId: 'pg/int4@1', nativeType: 'int4' },
              nullable: false,
            },
            {
              fieldName: 'homeAddress',
              columnName: 'home_address',
              valueObjectName: 'Address',
              nullable: true,
            },
          ],
          id: { columns: ['id'] },
        },
      ],
      valueObjects: [
        {
          name: 'Address',
          fields: [
            {
              fieldName: 'street',
              columnName: 'street',
              descriptor: { codecId: 'pg/text@1', nativeType: 'text' },
              nullable: false,
            },
            {
              fieldName: 'city',
              columnName: 'city',
              descriptor: { codecId: 'pg/text@1', nativeType: 'text' },
              nullable: false,
            },
          ],
        },
      ],
    });

    const userModel = contract.models as Record<
      string,
      { readonly fields: Record<string, ContractField> } | undefined
    >;

    expect(userModel['User']?.fields['homeAddress']).toEqual({
      type: { kind: 'valueObject', name: 'Address' },
      nullable: true,
    });
  });

  it('maps value object fields to JSONB storage columns', () => {
    const contract = buildSqlContractFromDefinition({
      target: postgresTargetPack,
      models: [
        {
          modelName: 'User',
          tableName: 'user',
          fields: [
            {
              fieldName: 'id',
              columnName: 'id',
              descriptor: { codecId: 'pg/int4@1', nativeType: 'int4' },
              nullable: false,
            },
            {
              fieldName: 'homeAddress',
              columnName: 'home_address',
              valueObjectName: 'Address',
              nullable: true,
            },
          ],
          id: { columns: ['id'] },
        },
      ],
      valueObjects: [
        {
          name: 'Address',
          fields: [
            {
              fieldName: 'street',
              columnName: 'street',
              descriptor: { codecId: 'pg/text@1', nativeType: 'text' },
              nullable: false,
            },
          ],
        },
      ],
    });

    const storage = contract.storage as unknown as {
      readonly tables: Record<
        string,
        { readonly columns: Record<string, { nativeType: string; codecId: string }> }
      >;
    };

    expect(storage.tables['user']?.columns['home_address']).toMatchObject({
      nativeType: 'jsonb',
      codecId: 'pg/jsonb@1',
      nullable: true,
    });
  });

  it('emits many: true for value object list fields', () => {
    const contract = buildSqlContractFromDefinition({
      target: postgresTargetPack,
      models: [
        {
          modelName: 'User',
          tableName: 'user',
          fields: [
            {
              fieldName: 'id',
              columnName: 'id',
              descriptor: { codecId: 'pg/int4@1', nativeType: 'int4' },
              nullable: false,
            },
            {
              fieldName: 'addresses',
              columnName: 'addresses',
              valueObjectName: 'Address',
              nullable: false,
              many: true,
            },
          ],
          id: { columns: ['id'] },
        },
      ],
      valueObjects: [
        {
          name: 'Address',
          fields: [
            {
              fieldName: 'street',
              columnName: 'street',
              descriptor: { codecId: 'pg/text@1', nativeType: 'text' },
              nullable: false,
            },
          ],
        },
      ],
    });

    const userModel = contract.models as Record<
      string,
      { readonly fields: Record<string, ContractField> } | undefined
    >;

    expect(userModel['User']?.fields['addresses']).toEqual({
      type: { kind: 'valueObject', name: 'Address' },
      nullable: false,
      many: true,
    });
  });

  it('emits nested value-object references inside a parent value object', () => {
    const contract = buildSqlContractFromDefinition({
      target: postgresTargetPack,
      models: [
        {
          modelName: 'Company',
          tableName: 'company',
          fields: [
            {
              fieldName: 'id',
              columnName: 'id',
              descriptor: { codecId: 'pg/int4@1', nativeType: 'int4' },
              nullable: false,
            },
            {
              fieldName: 'address',
              columnName: 'address',
              valueObjectName: 'CompanyAddress',
              nullable: false,
            },
          ],
          id: { columns: ['id'] },
        },
      ],
      valueObjects: [
        {
          name: 'GeoLocation',
          fields: [
            {
              fieldName: 'lat',
              columnName: 'lat',
              descriptor: { codecId: 'pg/float8@1', nativeType: 'float8' },
              nullable: false,
            },
            {
              fieldName: 'lng',
              columnName: 'lng',
              descriptor: { codecId: 'pg/float8@1', nativeType: 'float8' },
              nullable: false,
            },
          ],
        },
        {
          name: 'CompanyAddress',
          fields: [
            {
              fieldName: 'street',
              columnName: 'street',
              descriptor: { codecId: 'pg/text@1', nativeType: 'text' },
              nullable: false,
            },
            {
              fieldName: 'location',
              columnName: 'location',
              valueObjectName: 'GeoLocation',
              nullable: true,
            },
          ],
        },
      ],
    });

    const valueObjects = contract.valueObjects as Record<string, ContractValueObject> | undefined;

    expect(valueObjects?.['CompanyAddress']?.fields['location']).toEqual({
      type: { kind: 'valueObject', name: 'GeoLocation' },
      nullable: true,
    });
    expect(valueObjects?.['CompanyAddress']?.fields['street']).toEqual({
      type: { kind: 'scalar', codecId: 'pg/text@1' },
      nullable: false,
    });
    expect(valueObjects?.['GeoLocation']?.fields['lat']).toEqual({
      type: { kind: 'scalar', codecId: 'pg/float8@1' },
      nullable: false,
    });
  });

  it('omits valueObjects from contract when none are defined', () => {
    const contract = buildSqlContractFromDefinition({
      target: postgresTargetPack,
      models: [
        {
          modelName: 'User',
          tableName: 'user',
          fields: [
            {
              fieldName: 'id',
              columnName: 'id',
              descriptor: { codecId: 'pg/int4@1', nativeType: 'int4' },
              nullable: false,
            },
          ],
          id: { columns: ['id'] },
        },
      ],
    });

    expect(contract.valueObjects).toBeUndefined();
  });

  it('maps value object field to correct storage bridge entry', () => {
    const contract = buildSqlContractFromDefinition({
      target: postgresTargetPack,
      models: [
        {
          modelName: 'User',
          tableName: 'user',
          fields: [
            {
              fieldName: 'id',
              columnName: 'id',
              descriptor: { codecId: 'pg/int4@1', nativeType: 'int4' },
              nullable: false,
            },
            {
              fieldName: 'homeAddress',
              columnName: 'home_address',
              valueObjectName: 'Address',
              nullable: true,
            },
          ],
          id: { columns: ['id'] },
        },
      ],
      valueObjects: [
        {
          name: 'Address',
          fields: [
            {
              fieldName: 'street',
              columnName: 'street',
              descriptor: { codecId: 'pg/text@1', nativeType: 'text' },
              nullable: false,
            },
          ],
        },
      ],
    });

    const userModel = contract.models as unknown as Record<
      string,
      | {
          readonly storage: { readonly fields: Record<string, { readonly column: string }> };
        }
      | undefined
    >;

    expect(userModel['User']?.storage.fields['homeAddress']).toEqual({
      column: 'home_address',
    });
  });
});
