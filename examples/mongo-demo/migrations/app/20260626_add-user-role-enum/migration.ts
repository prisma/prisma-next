import { MigrationCLI } from '@prisma-next/cli/migration-cli';
import { MongoContractSerializer } from '@prisma-next/family-mongo/ir';
import { Migration } from '@prisma-next/family-mongo/migration';
import { setValidation } from '@prisma-next/target-mongo/migration';
import type { Contract } from './end-contract';
import endContractJson from './end-contract.json' with { type: 'json' };

const endContract = new MongoContractSerializer().deserializeContract<Contract>(endContractJson);

// Sourced from the contract snapshot so this stays in sync if the chain is re-emitted.
const USERS_VALIDATOR =
  endContract.storage.namespaces.__unbound__.entries.collection.users.validator;

class AddUserRoleEnum extends Migration {
  override describe() {
    return {
      from: 'sha256:2827cbad7293fe13a4fb2aab60a55d3cddd856a86d1f6ccea6e11519faacff92',
      to: 'sha256:250af57beb0580c2c9562789d5d05ae39bcfabd08b2eca8367f59a70fa724b7d',
    };
  }

  override get operations() {
    return [
      setValidation('users', USERS_VALIDATOR.jsonSchema, {
        validationLevel: USERS_VALIDATOR.validationLevel,
        validationAction: USERS_VALIDATOR.validationAction,
      }),
    ];
  }
}

export default AddUserRoleEnum;
MigrationCLI.run(import.meta.url, AddUserRoleEnum);
