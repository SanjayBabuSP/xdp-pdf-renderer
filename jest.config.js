/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  testTimeout: 30000,
  // WSL / low-memory guardrails. The default worker count (cores-1, up to 15
  // here) forks a ts-jest process per core; each one fully type-checks the
  // project and loads pdf-lib + fontkit + bundled fonts, which exhausted the
  // 7.7 GiB host and killed the session. Two workers plus a per-worker heap
  // cap keeps peak RSS bounded.
  maxWorkers: 2,
  workerIdleMemoryLimit: '512MB',
  transform: {
    // tsconfig.test.json enables `isolatedModules` for transpile-only output.
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }],
  },
};
