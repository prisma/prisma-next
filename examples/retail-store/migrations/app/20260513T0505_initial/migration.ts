#!/usr/bin/env -S node
import { MigrationCLI } from '@prisma-next/cli/migration-cli';
import { MongoContractView } from '@prisma-next/family-mongo/ir';
import { Migration } from '@prisma-next/family-mongo/migration';
import { createCollection, createIndex } from '@prisma-next/target-mongo/migration';
import type { Contract } from './end-contract';
import endContractJson from './end-contract.json' with { type: 'json' };

const endContract = MongoContractView.fromJson<Contract>(endContractJson);

const COLLECTIONS = endContract.collection;
const CARTS_VALIDATOR = COLLECTIONS.carts.validator;
const EVENTS_VALIDATOR = COLLECTIONS.events.validator;
const INVOICES_VALIDATOR = COLLECTIONS.invoices.validator;
const LOCATIONS_VALIDATOR = COLLECTIONS.locations.validator;
const ORDERS_VALIDATOR = COLLECTIONS.orders.validator;
const PRODUCTS_VALIDATOR = COLLECTIONS.products.validator;
const USERS_VALIDATOR = COLLECTIONS.users.validator;

class M extends Migration {
  override describe() {
    return {
      from: null,
      to: 'sha256:8ee1e7ce30ed334572583d826d9c41388c46f7db82ae2352c3a3fccf1de7cbab',
    };
  }

  override get operations() {
    return [
      createCollection('carts', {
        validator: { $jsonSchema: CARTS_VALIDATOR.jsonSchema },
        validationLevel: CARTS_VALIDATOR.validationLevel,
        validationAction: CARTS_VALIDATOR.validationAction,
      }),
      createCollection('events', {
        validator: { $jsonSchema: EVENTS_VALIDATOR.jsonSchema },
        validationLevel: EVENTS_VALIDATOR.validationLevel,
        validationAction: EVENTS_VALIDATOR.validationAction,
      }),
      createCollection('invoices', {
        validator: { $jsonSchema: INVOICES_VALIDATOR.jsonSchema },
        validationLevel: INVOICES_VALIDATOR.validationLevel,
        validationAction: INVOICES_VALIDATOR.validationAction,
      }),
      createCollection('locations', {
        validator: { $jsonSchema: LOCATIONS_VALIDATOR.jsonSchema },
        validationLevel: LOCATIONS_VALIDATOR.validationLevel,
        validationAction: LOCATIONS_VALIDATOR.validationAction,
      }),
      createCollection('orders', {
        validator: { $jsonSchema: ORDERS_VALIDATOR.jsonSchema },
        validationLevel: ORDERS_VALIDATOR.validationLevel,
        validationAction: ORDERS_VALIDATOR.validationAction,
      }),
      createCollection('products', {
        validator: { $jsonSchema: PRODUCTS_VALIDATOR.jsonSchema },
        validationLevel: PRODUCTS_VALIDATOR.validationLevel,
        validationAction: PRODUCTS_VALIDATOR.validationAction,
      }),
      createCollection('users', {
        validator: { $jsonSchema: USERS_VALIDATOR.jsonSchema },
        validationLevel: USERS_VALIDATOR.validationLevel,
        validationAction: USERS_VALIDATOR.validationAction,
      }),
      createIndex('carts', [{ direction: 1, field: 'userId' }], { unique: true }),
      createIndex(
        'events',
        [
          { direction: 1, field: 'userId' },
          { direction: -1, field: 'timestamp' },
        ],
        {},
      ),
      createIndex('events', [{ direction: 1, field: 'timestamp' }], {
        expireAfterSeconds: 7776000,
      }),
      createIndex('invoices', [{ direction: 1, field: 'orderId' }], {}),
      createIndex('invoices', [{ direction: -1, field: 'issuedAt' }], { sparse: true }),
      createIndex(
        'locations',
        [
          { direction: 1, field: 'city' },
          { direction: 1, field: 'country' },
        ],
        { collation: { locale: 'en', strength: 2 } },
      ),
      createIndex('orders', [{ direction: 1, field: 'userId' }], {}),
      createIndex(
        'products',
        [
          { direction: 'text', field: 'name' },
          { direction: 'text', field: 'description' },
        ],
        { weights: { description: 1, name: 10 } },
      ),
      createIndex(
        'products',
        [
          { direction: 1, field: 'brand' },
          { direction: 1, field: 'subCategory' },
        ],
        {},
      ),
      createIndex('products', [{ direction: 'hashed', field: 'code' }], {}),
      createIndex('users', [{ direction: 1, field: 'email' }], { unique: true }),
    ];
  }
}

export default M;
MigrationCLI.run(import.meta.url, M);
