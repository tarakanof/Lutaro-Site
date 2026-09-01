#!/usr/bin/env node
/**
 * Checks every internal link in the built site.
 *
 * Astro's `base` prefix makes it easy to ship an href that 404s only in
 * production (a missing `/Lutaro-Site` prefix works fine in dev), so this runs
 * over `dist/` and resolves each internal href to a real file or a real `id=`
 * on the target page. External links are listed, never fetched - the build must
 * stay offline and deterministic.
 */
import { readFileSync } from 'node:fs';
import { glob } from 'node:fs/promises';
import path from 'node:path';

const DIST = path.resolve('dist');

const pages = [];
for await (const file of glob('**/*.html', { cwd: DIST })) pages.push(file);
if (pages.length === 0) {
  console.error('check-links: dist/ has no HTML - run `npm run build` first');
  process.exit(1);
}

const html = new Map(pages.map((file) => [file, readFileSync(path.join(DIST, file), 'utf8')]));

/** Every `id="..."` on a built page, so fragment links can be checked too. */
const anchors = new Map(
  [...html].map(([file, source]) => [
    file,
    new Set([...source.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1])),
  ]),
);

/** `dist/setup/index.html` is served at `/Lutaro-Site/setup/`. */
const servedPath = (file) => {
  const url = '/' + file.replace(/index\.html$/, '').replace(/\.html$/, '');
  return url.replace(/\/{2,}/g, '/');
};
const routes = new Map([...html.keys()].map((file) => [servedPath(file), file]));

/** Static assets (`public/`) are served at their own path, verbatim. */
for await (const file of glob('**/*', { cwd: DIST, withFileTypes: true })) {
  if (file.isFile() && !file.name.endsWith('.html')) {
    const relative = path.relative(DIST, path.join(file.parentPath, file.name));
    routes.set('/' + relative.split(path.sep).join('/'), null);
  }
}

const { base: configuredBase = '/' } = (await import('../astro.config.mjs')).default;
const base = configuredBase.replace(/\/$/, '');
const failures = [];
let checked = 0;
const external = new Set();

for (const [file, source] of html) {
  for (const [, href] of source.matchAll(/<a\b[^>]*\shref="([^"]*)"/g)) {
    if (/^(https?:|mailto:|tel:)/.test(href)) {
      external.add(href);
      continue;
    }
    if (href === '' || href.startsWith('#')) {
      checked += 1;
      const id = href.slice(1);
      if (id && !anchors.get(file).has(id)) failures.push(`${file}: no element with id="${id}"`);
      continue;
    }
    if (!href.startsWith('/')) {
      failures.push(`${file}: relative href "${href}" - use the BASE_URL prefix instead`);
      continue;
    }
    checked += 1;
    const [target, fragment] = href.split('#');
    if (!target.startsWith(`${base}/`) && target !== base) {
      failures.push(`${file}: "${href}" is missing the "${base}" base prefix`);
      continue;
    }
    const normalized = target.replace(base, '') || '/';
    const key = routes.has(normalized) ? normalized : `${normalized.replace(/\/$/, '')}/`;
    if (!routes.has(key)) {
      failures.push(`${file}: "${href}" resolves to nothing in dist/`);
      continue;
    }
    const targetFile = routes.get(key);
    if (fragment && targetFile && !anchors.get(targetFile).has(fragment)) {
      failures.push(`${file}: "${href}" - ${targetFile} has no id="${fragment}"`);
    }
  }
}

console.log(
  `check-links: ${pages.length} pages, ${checked} internal links checked, ` +
    `${external.size} external links listed (not fetched)`,
);
if (failures.length > 0) {
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}
console.log('check-links: ok');
