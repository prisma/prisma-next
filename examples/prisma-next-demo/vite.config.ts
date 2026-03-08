import { prismaVitePlugin } from '@prisma-next/vite-plugin-contract-emit';
import react from '@vitejs/plugin-react-swc';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), prismaVitePlugin()],
});
