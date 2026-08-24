import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Type-aware linting is the point here rather than style. A forgotten `await` on
 * `editor.edit()` or on a `setContext` call type-checks cleanly but produces a
 * caret that lands before the edit has been applied, which is exactly the class
 * of bug `no-floating-promises` and `no-misused-promises` catch.
 */
export default tseslint.config(
  { ignores: ['out/**'] },

  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      '@typescript-eslint/explicit-function-return-type': ['warn', { allowExpressions: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always'],

      // `test()` from node:test returns a promise that callers are not meant to
      // await. Declaring it safe keeps the rule enforced everywhere else rather
      // than switching it off for the whole test directory.
      '@typescript-eslint/no-floating-promises': [
        'error',
        {
          allowForKnownSafeCalls: [
            {
              from: 'package',
              package: 'node:test',
              name: ['after', 'afterEach', 'before', 'beforeEach', 'describe', 'it', 'test']
            }
          ]
        }
      ]
    }
  },

  // Plain JavaScript that is not part of the TypeScript project: this config, and
  // the build scripts. Still linted — only the rules that need type information
  // are dropped, since there is no program for them to consult.
  {
    files: ['eslint.config.mjs', 'scripts/**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked]
  }
);
