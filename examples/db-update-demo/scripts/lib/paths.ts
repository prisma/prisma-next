import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = dirname(fileURLToPath(import.meta.url));

export const demoRoot = resolve(currentDir, '..', '..');
export const contractsDir = resolve(demoRoot, 'contracts');
export const prismaDir = resolve(demoRoot, 'prisma');
export const contractPath = resolve(prismaDir, 'contract.ts');
export const contractJsonPath = resolve(prismaDir, 'contract.json');
export const configPath = resolve(demoRoot, 'prisma-next.config.ts');
