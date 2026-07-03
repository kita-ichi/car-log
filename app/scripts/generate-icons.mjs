/**
 * PWAアイコン生成スクリプト
 * public/icon.svg(原版)から 192px / 512px のPNGを生成する。
 * 実行: npm run icons(sharp は devDependency)
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import sharp from 'sharp'

const root = path.dirname(fileURLToPath(import.meta.url))
const publicDir = path.join(root, '..', 'public')
const svg = await readFile(path.join(publicDir, 'icon.svg'))

for (const size of [192, 512]) {
  const out = path.join(publicDir, `icon-${size}.png`)
  await sharp(svg, { density: 300 }).resize(size, size).png().toFile(out)
  console.log(`generated: ${out}`)
}
