import { defineConfig } from 'vite';
import { hubImages } from './images-plugin';
import { sitePages } from './site-plugin';

export default defineConfig({
  base: '/',
  plugins: [sitePages(), hubImages()],
});
