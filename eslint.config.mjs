import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // package.json has no "type": "module", so plain .js/.cjs files are CommonJS:
  // require() is the only correct import form there. The TS-specific rule is a
  // false positive on CJS scripts — converting them to ESM would change runtime
  // behavior (module resolution, __dirname, import hoisting).
  {
    files: ["**/*.js", "**/*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Git worktrees checked out under the repo (e.g. .worktrees/preview for a
    // parallel preview build) carry their own .next/ output. They are excluded
    // from git via .git/info/exclude, so nothing in them is repo source; without
    // this entry `eslint .` lints thousands of generated chunk files.
    ".worktrees/**",
  ]),
]);

export default eslintConfig;
