/** @type {import('ts-jest').JestConfigWithTsJest} */
export default {
  transform: { "^.+\\.tsx?$": "ts-jest" },
  testEnvironment: "node",
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
  moduleDirectories: ["node_modules", "src"],
  extensionsToTreatAsEsm: [".ts"],
  testRegex: "/dist/.+\\.test.+$",
  setupFiles: ["<rootDir>/test-setup.js"],
};
