import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    threads: false,
    testTimeout: 10000,
  },
});

