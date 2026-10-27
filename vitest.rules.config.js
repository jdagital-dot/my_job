import { defineConfig } from 'vitest/config'

// Firestore Emulator が起動している前提で実行する（npm run test:rules / npm run test:e2e）
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/rules/**/*.test.js', 'tests/integration/**/*.test.js'],
    testTimeout: 20000,
    fileParallelism: false,
  },
})
