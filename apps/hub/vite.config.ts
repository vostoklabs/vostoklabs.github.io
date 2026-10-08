import { defineConfig } from 'vite';
import { sitePages } from './site-plugin';

export default defineConfig({
  base: '/',
  plugins: [sitePages()],
});
