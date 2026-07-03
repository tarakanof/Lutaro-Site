import { defineConfig } from 'astro/config';

// Hosted at https://tarakanof.github.io/Lutaro-Site/ (project Pages, no
// custom domain). If a custom domain is added later, set `site` to it and
// drop `base` — page URLs (/setup/, /privacy/) stay the same.
export default defineConfig({
  site: 'https://tarakanof.github.io',
  base: '/Lutaro-Site',
});
