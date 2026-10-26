import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "node_modules/**",
    "tests/load/**",
  ]),
  {
    rules: {
      // R-CODE-08: no console in production code
      "no-console": "error",

      // R-CODE-03: no explicit any
      "@typescript-eslint/no-explicit-any": "error",

      // Require explicit return types on module-boundary functions
      "@typescript-eslint/explicit-module-boundary-types": "off",

      // Enforce consistent type imports
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],

      // No unused vars (use _ prefix to ignore)
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],

      // R-SEC-03: no template literals in SQL (catches obvious cases)
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "TaggedTemplateExpression[tag.name='sql'] TemplateLiteral",
          message:
            "Do not interpolate strings into sql`` — use parameterized queries only (R-SEC-03).",
        },
      ],

      // Prefer const
      "prefer-const": "error",

      // No var
      "no-var": "error",
    },
  },
]);

export default eslintConfig;
