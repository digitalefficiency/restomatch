// ESLint flat config for apps/web (Next 15 core-web-vitals + TypeScript rules).
// Run: `pnpm --filter @restomatch/web lint`. Not part of `next build`
// (next.config.ts ignoreDuringBuilds) — it is a separate CI step.
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  {
    ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts', 'test-results/**', 'playwright-report/**'],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      // Hebrew abbreviations are written with a straight quote as gershayim
      // (ש"ח, בע"מ, מע"מ); escaping every one as &quot; is pure noise.
      'react/no-unescaped-entities': 'off',
    },
  },
];

export default config;
