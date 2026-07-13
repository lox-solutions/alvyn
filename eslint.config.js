// @ts-check
import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import llmCore from "eslint-plugin-llm-core";
import tseslint from "typescript-eslint";

export default defineConfig(
  {
    ignores: [
      "dist/",
      "node_modules/",
      "website/",
      "coverage/",
      "examples/example-alvyn-full-stack-app/",
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  ...llmCore.configs.all,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["eslint.config.js", "vitest.config.ts"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true },
      ],
      // complementary core rules for AI-generated code
      "no-nested-ternary": "error",
      "no-useless-assignment": "error",
    },
  },
  {
    files: ["**/*.test.ts", "**/__tests__/**/*.ts"],
    rules: {
      "@typescript-eslint/consistent-type-definitions": "off",
      // test files legitimately use magic numbers and empty functions
      "llm-core/no-magic-numbers": "off",
      "llm-core/max-file-length": "off",
      "llm-core/structured-logging": "off",
    },
  },
  {
    files: ["vitest.config.ts"],
    rules: {
      "llm-core/no-magic-numbers": "off",
    },
  },
);
