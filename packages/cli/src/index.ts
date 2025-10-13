import { Command } from 'commander';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { parse } from '@prisma/psl';
import { emitContractAndTypes } from '@prisma/schema-emitter';

const program = new Command();

program
  .name('prisma-next')
  .description('Prisma Next CLI - Type-safe query DSL for PostgreSQL')
  .version('0.0.0');

program
  .command('generate')
  .description('Generate contract.json and types.d.ts from PSL file')
  .argument('<psl-file>', 'Path to the PSL file')
  .option('-o, --output-dir <dir>', 'Output directory for generated files', '.prisma')
  .action(async (pslFile: string, options: { outputDir: string }) => {
    try {
      console.log(`📖 Reading PSL file: ${pslFile}`);
      const pslContent = readFileSync(pslFile, 'utf-8');

      console.log('🔍 Parsing PSL...');
      const ast = parse(pslContent);

      console.log('⚡ Generating data contract and types...');
      const { contract, contractTypes } = await emitContractAndTypes(ast);

      // Ensure output directory exists
      mkdirSync(options.outputDir, { recursive: true });

      // Write contract.json
      const contractPath = `${options.outputDir}/contract.json`;
      writeFileSync(contractPath, contract);
      console.log(`✅ Generated ${contractPath}`);

      // Write contract.d.ts
      const contractTypesPath = `${options.outputDir}/contract.d.ts`;
      writeFileSync(contractTypesPath, contractTypes);
      console.log(`✅ Generated ${contractTypesPath}`);

      console.log('🎉 Data contract generation complete!');
    } catch (error) {
      console.error('❌ Error generating data contract:', error);
      process.exit(1);
    }
  });

program
  .command('dev')
  .description('Start development mode with file watching')
  .argument('<psl-file>', 'Path to the PSL file')
  .option('-o, --output-dir <dir>', 'Output directory for generated files', '.prisma')
  .action(async (pslFile: string, options: { outputDir: string }) => {
    console.log('🚀 Starting development mode...');
    console.log(`📁 Watching: ${pslFile}`);
    console.log(`📁 Output: ${options.outputDir}`);

    // For now, just run generate once
    // In a real implementation, this would watch for file changes
    try {
      const pslContent = readFileSync(pslFile, 'utf-8');
      const ast = parse(pslContent);
      const { contract, contractTypes } = await emitContractAndTypes(ast);

      mkdirSync(options.outputDir, { recursive: true });
      writeFileSync(`${options.outputDir}/contract.json`, contract);
      writeFileSync(`${options.outputDir}/contract.d.ts`, contractTypes);

      console.log('✅ Initial generation complete!');
      console.log('💡 Tip: Re-run this command when you modify your PSL');
    } catch (error) {
      console.error('❌ Error in development mode:', error);
      process.exit(1);
    }
  });

program.parse();
