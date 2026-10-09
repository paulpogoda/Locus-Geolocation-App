/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, type Plugin } from 'vite';

/**
 * Content Security Policy for the built app (ADR-001, stage 1, item 3).
 * Injected as <meta> so it applies on any static host. The host should also send
 * it as a Content-Security-Policy header with `frame-ancestors 'none'` added:
 * that directive only works in a header.
 * style-src needs 'unsafe-inline': the Google Search suggestions chip ships inline
 * styles and is rendered via srcdoc, which inherits this policy.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.tile.openstreetmap.org https://server.arcgisonline.com",
  "font-src 'self' data:",
  "connect-src 'self' https://generativelanguage.googleapis.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  'upgrade-insecure-requests',
].join('; ');

// Build only: the dev server relies on inline scripts for HMR.
const cspMeta = (): Plugin => ({
  name: 'locus-csp-meta',
  apply: 'build',
  transformIndexHtml: () => [
    { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CONTENT_SECURITY_POLICY }, injectTo: 'head-prepend' },
  ],
});

// No secrets are injected into the client bundle. In BYOK mode the user's
// Gemini key is entered at runtime and never exists at build time.
export default defineConfig({
  // Relative asset paths: the same build works under /Locus-Geolocation-App/ on
  // GitHub Pages and at the root of a custom domain.
  base: './',
  plugins: [react(), tailwindcss(), cspMeta()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  server: {
    hmr: process.env.DISABLE_HMR !== 'true',
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
