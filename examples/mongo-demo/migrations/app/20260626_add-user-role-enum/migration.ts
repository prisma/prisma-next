import { MigrationCLI } from '@prisma-next/cli/migration-cli';
import { Migration } from '@prisma-next/family-mongo/migration';
import { setValidation } from '@prisma-next/target-mongo/migration';

const USERS_SCHEMA = {
  additionalProperties: false,
  bsonType: 'object',
  properties: {
    _id: { bsonType: 'objectId' },
    address: {
      oneOf: [
        { bsonType: 'null' },
        {
          additionalProperties: false,
          bsonType: 'object',
          properties: {
            city: { bsonType: 'string' },
            country: { bsonType: 'string' },
            street: { bsonType: 'string' },
            zip: { bsonType: ['null', 'string'] },
          },
          required: ['city', 'country', 'street'],
        },
      ],
    },
    bio: { bsonType: ['null', 'string'] },
    email: { bsonType: 'string' },
    name: { bsonType: 'string' },
    role: { bsonType: 'string', enum: ['admin', 'author', 'reader'] },
  },
  required: ['_id', 'email', 'name', 'role'],
} as const;

class AddUserRoleEnum extends Migration {
  override describe() {
    return {
      from: 'sha256:2827cbad7293fe13a4fb2aab60a55d3cddd856a86d1f6ccea6e11519faacff92',
      to: 'sha256:250af57beb0580c2c9562789d5d05ae39bcfabd08b2eca8367f59a70fa724b7d',
    };
  }

  override get operations() {
    return [
      setValidation('users', USERS_SCHEMA, {
        validationLevel: 'strict',
        validationAction: 'error',
      }),
    ];
  }
}

export default AddUserRoleEnum;
MigrationCLI.run(import.meta.url, AddUserRoleEnum);
