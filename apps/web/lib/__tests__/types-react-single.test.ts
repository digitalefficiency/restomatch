/**
 * One @types/react for the web program: apps/web and every workspace package it
 * imports must resolve the same @types/react (the one apps/web pins), so the
 * Next type check never sees two React type trees. apps/mobile keeps its own 18.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const resolveFrom = (dir: string) =>
  (createRequire(`${repoRoot}${dir}/package.json`)('@types/react/package.json') as { version: string }).version;
const pinned = (createRequire(`${repoRoot}apps/web/package.json`)('./package.json') as {
  devDependencies: Record<string, string>;
}).devDependencies['@types/react'];

describe('@types/react single version for the web program', () => {
  it('apps/web resolves the version it pins', () => {
    expect(resolveFrom('apps/web')).toBe(pinned);
  });

  it.each(['packages/db', 'packages/api', 'packages/charts', 'packages/types', 'packages/ui-tokens', 'apps/worker'])(
    '%s resolves the same @types/react as apps/web',
    (dir) => {
      expect(resolveFrom(dir)).toBe(resolveFrom('apps/web'));
    },
  );

  it('apps/mobile keeps React 18 types', () => {
    expect(resolveFrom('apps/mobile').split('.')[0]).toBe('18');
  });
});
