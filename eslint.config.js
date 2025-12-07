import globals from 'globals';
import babelParser from '@babel/eslint-parser';
import authressConfig from '@authress/eslint-config/lib/index.js';
import importPlugin from 'eslint-plugin-import';

export default [
  // 1. Global ignores
  {
    ignores: ['node_modules/']
  },

  // // 2. Configurations you are extending
  ...authressConfig,

  // // 3. Your main configuration for all JavaScript files
  {
    files: ['**/*.js'],
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        sourceType: 'module',
        ecmaVersion: 'latest',
        requireConfigFile: false
      },
      globals: {
        ...globals.node,
        ...globals.es2021,
        ...globals.mocha,
        fetch: 'readonly'
      }
    },
    settings: {
      "import/resolver": {
        node: true
      }
    },
    plugins: {
      import: importPlugin
    },
    rules: {
      // Your custom rules go here
      'arrow-parens': ['error', 'as-needed'],
      'indent': ['error', 2, { SwitchCase: 1, MemberExpression: 'off' }],
      'node/no-unsupported-features/es-syntax': 'off',
      'no-throw-literal': 'off',
      'spaced-comment': 'off',
      'no-continue': 'off',
      'require-atomic-updates': 'off',
      'no-constant-condition': ['error', { checkLoops: false }],
      'quotes': 'off'
    }
  },

  // 4. Your specific override for test files and scripts
  {
    files: ['make.js', 'tests/**'],
    rules: {
      'import/no-extraneous-dependencies': ['error', { devDependencies: true }]
    }
  }
];
