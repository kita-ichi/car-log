/**
 * Base64 変換(純粋関数)
 * 用途: F-11 JSONバックアップに愛車の写真(バイナリ)を埋め込む / F-15 インポートで復元する
 *
 * JSON はテキストしか運べないため、画像バイト列を Base64 文字列にして格納する。
 * (Base64 はバイト数が約 4/3 に増える。バックアップに写真を含めるかを
 *  選べるようにしているのはこのため — db/exportService.ts の includePhotos)
 *
 * btoa / atob や Buffer に依存せず自前で実装している。理由:
 * - btoa は「1文字=1バイト」の文字列を要求するため、バイト列との相互変換に
 *   毎回 String.fromCharCode を挟む必要があり、実装の正しさが分かりにくい
 * - Node(vitest environment: 'node')とブラウザで同じコードを検証したい
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** 文字 → 6bit 値の逆引き表(不正文字は -1) */
const DECODE_TABLE: Int8Array = (() => {
  const table = new Int8Array(128).fill(-1)
  for (let i = 0; i < ALPHABET.length; i++) table[ALPHABET.charCodeAt(i)] = i
  return table
})()

/** 一度に組み立てる文字数の目安(巨大な画像でも文字列連結で詰まらないよう分割する) */
const CHUNK_BYTES = 3 * 1024

/** Base64 デコードに失敗したときのエラー(壊れたバックアップファイルの検知に使う) */
export class Base64Error extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'Base64Error'
  }
}

/**
 * バイト列 → Base64 文字列(パディング `=` あり・改行なし)。
 * 空のバイト列は空文字を返す。
 */
export function bytesToBase64(bytes: Uint8Array): string {
  const chunks: string[] = []
  for (let start = 0; start < bytes.length; start += CHUNK_BYTES) {
    chunks.push(encodeChunk(bytes, start, Math.min(start + CHUNK_BYTES, bytes.length)))
  }
  return chunks.join('')
}

function encodeChunk(bytes: Uint8Array, start: number, end: number): string {
  let out = ''
  let i = start
  // 3バイト(24bit)を 4文字(6bit x 4)に変換する
  for (; i + 2 < end; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]
    out +=
      ALPHABET[(n >>> 18) & 63] + ALPHABET[(n >>> 12) & 63] + ALPHABET[(n >>> 6) & 63] + ALPHABET[n & 63]
  }
  // 端数(1〜2バイト)は `=` で 4文字に揃える
  const rest = end - i
  if (rest === 1) {
    const n = bytes[i] << 16
    out += ALPHABET[(n >>> 18) & 63] + ALPHABET[(n >>> 12) & 63] + '=='
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8)
    out += ALPHABET[(n >>> 18) & 63] + ALPHABET[(n >>> 12) & 63] + ALPHABET[(n >>> 6) & 63] + '='
  }
  return out
}

/**
 * Base64 文字列 → バイト列。
 * 空白・改行は読み飛ばす(手で整形されたJSONからの復元を許容するため)。
 *
 * @throws {Base64Error} 不正な文字が含まれる / 長さが不正な場合
 */
export function base64ToBytes(base64: string): Uint8Array {
  if (typeof base64 !== 'string') throw new Base64Error('Base64 文字列ではありません')

  // 空白類とパディングを除いた「有効な6bit文字」だけを取り出す
  const clean = base64.replace(/[\s]/g, '')
  const body = clean.replace(/=+$/, '')
  if (body.includes('=')) throw new Base64Error('Base64 のパディング位置が不正です')
  if (body.length % 4 === 1) throw new Base64Error(`Base64 の長さが不正です: ${body.length}`)

  const outLength = Math.floor((body.length * 3) / 4)
  const out = new Uint8Array(outLength)
  let o = 0
  let buffer = 0
  let bits = 0

  for (let i = 0; i < body.length; i++) {
    const code = body.charCodeAt(i)
    const value = code < 128 ? DECODE_TABLE[code] : -1
    if (value < 0) throw new Base64Error(`Base64 に使えない文字が含まれています: ${JSON.stringify(body[i])}`)
    buffer = (buffer << 6) | value
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[o++] = (buffer >>> bits) & 0xff
    }
  }
  return out
}

/** Base64 に変換した後の文字数(バックアップの見積もりサイズ表示用) */
export function base64Length(byteLength: number): number {
  if (!Number.isFinite(byteLength) || byteLength <= 0) return 0
  return Math.ceil(byteLength / 3) * 4
}

/** `data:image/jpeg;base64,....` 形式の Data URL を組み立てる(img の src に直接使える) */
export function toDataUrl(mimeType: string, base64: string): string {
  return `data:${mimeType};base64,${base64}`
}

/**
 * Data URL を MIME タイプと Base64 本体に分解する。
 * @throws {Base64Error} Base64 の Data URL でない場合
 */
export function parseDataUrl(dataUrl: string): { mimeType: string; base64: string } {
  const match = /^data:([^;,]*)(;[^,]*)?;base64,(.*)$/s.exec(dataUrl ?? '')
  if (!match) throw new Base64Error('Base64 形式の Data URL ではありません')
  return { mimeType: match[1] || 'application/octet-stream', base64: match[3] }
}
