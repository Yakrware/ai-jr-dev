/** @type {import('ts-jest').JestConfigWithTsJest} */
export default {
  preset: 'ts-jest/presets/default-esm', // Use ESM preset for ts-jest
  testEnvironment: 'node',
  moduleNameMapper: {
    // Handle module aliases (if you have them in tsconfig.json)
    // Example: '^@/(.*)$': '<rootDir>/src/$1'
  },
  extensionsToTreatAsEsm: ['.ts'], // Treat .ts files as ES Modules
  globals: {
    'ts-jest': {
      useESM: true, // Ensure ts-jest uses ESM
    },
  },
  // Automatically clear mock calls, instances, contexts and results before every test
  clearMocks: true,
  // Indicates whether the coverage information should be collected while executing the test
  collectCoverage: true,
  // The directory where Jest should output its coverage files
  coverageDirectory: "coverage",
  // An array of glob patterns indicating a set of files for which coverage information should be collected
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.test.ts'], // Collect coverage from src, excluding test files
  // The test runner that will be used to execute the tests
  // testRunner: "jest-circus/runner", // Optional: Use jest-circus runner if needed
};
