// Mirrors the ESLint rules GNOME Shell's own extensions repo uses, per the
// EGO review guidelines: https://gjs.guide/extensions/review-guidelines/review-guidelines.html
// Source: https://gitlab.gnome.org/GNOME/gnome-shell-extensions/-/blob/main/tools/eslint.config.js

import {defineConfig} from '@eslint/config-helpers';
import gnome from 'eslint-config-gnome';

export default defineConfig([
    gnome.configs.recommended,
    gnome.configs.jsdoc,
    {
        rules: {
            camelcase: ['error', {
                properties: 'never',
            }],
            'consistent-return': 'error',
            'eqeqeq': ['error', 'smart'],
            'key-spacing': ['error', {
                mode: 'minimum',
                beforeColon: false,
                afterColon: true,
            }],
            'prefer-arrow-callback': 'error',
            'prefer-const': ['error', {
                destructuring: 'all',
            }],
            'jsdoc/require-param-description': 'off',
            'jsdoc/require-jsdoc': ['error', {
                exemptEmptyFunctions: true,
                publicOnly: {
                    esm: true,
                },
            }],
        },
        languageOptions: {
            globals: {
                global: 'readonly',
            },
        },
    },
]);
