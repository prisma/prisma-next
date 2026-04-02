import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mongoFamilyDescriptor, mongoTargetDescriptor } from '@prisma-next/family-mongo/control';
import { createControlStack } from '@prisma-next/framework-components/control';
import {
  createMongoScalarTypeDescriptors,
  interpretPslDocumentToMongoContractIR,
} from '@prisma-next/mongo-contract-psl';
import { parsePslDocument } from '@prisma-next/psl-parser';

async function main() {
  const schemaPath = resolve(import.meta.dirname, '..', 'prisma', 'schema.psl');
  const schema = readFileSync(schemaPath, 'utf-8');

  const document = parsePslDocument({ schema, sourceId: 'prisma/schema.psl' });
  const interpreted = interpretPslDocumentToMongoContractIR({
    document,
    scalarTypeDescriptors: createMongoScalarTypeDescriptors(),
  });

  if (!interpreted.ok) {
    console.error('Schema interpretation failed:');
    for (const d of interpreted.failure.diagnostics) {
      console.error(`  [${d.code}] ${d.message}`);
    }
    process.exit(1);
  }

  const controlStack = createControlStack({
    family: mongoFamilyDescriptor,
    target: mongoTargetDescriptor,
  });

  const instance = mongoFamilyDescriptor.create(controlStack);

  const result = await instance.emitContract({ contractIR: interpreted.value });

  const srcDir = resolve(import.meta.dirname, '..', 'src');
  writeFileSync(resolve(srcDir, 'contract.json'), `${result.contractJson}\n`);
  writeFileSync(resolve(srcDir, 'contract.d.ts'), result.contractDts);
  console.log('Generated contract.json and contract.d.ts in src/');
}

main().catch((err) => {
  console.error('Failed to generate contract:', err);
  process.exit(1);
});
