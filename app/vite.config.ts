/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages(サブパス配信)を想定した相対ベース。独自ドメイン等に変える場合は要調整
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'カーメンテナンス記録・燃費計算',
        short_name: 'カーメンテ',
        description: '車・バイクの給油記録・燃費計算(満タン法)・メンテナンス履歴管理',
        lang: 'ja',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#1b2a4a',
        background_color: '#ffffff',
        start_url: './',
        // TODO(ui-ux-designer/frontend-developer): アイコン画像(192px/512px)を public/ に追加して登録する
        icons: [],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
