/**
 * Base64 変換のテスト(F-11 バックアップへの写真埋め込み用)
 * - バイト列 ↔ Base64 文字列の往復(端数1・2バイト、全256バイト値、大きめのデータ)
 * - 既知のベクタ(RFC 4648)との一致
 * - 不正入力の検知
 */
import { describe, expect, it } from 'vitest'
import { Base64Error, base64Length, base64ToBytes, bytesToBase64, parseDataUrl, toDataUrl } from './base64'

const bytes = (...values: number[]) => new Uint8Array(values)
const ascii = (text: string) => new Uint8Array([...text].map((c) => c.charCodeAt(0)))

describe('bytesToBase64 / base64ToBytes(往復)', () => {
  it('RFC 4648 のテストベクタと一致する', () => {
    expect(bytesToBase64(ascii(''))).toBe('')
    expect(bytesToBase64(ascii('f'))).toBe('Zg==')
    expect(bytesToBase64(ascii('fo'))).toBe('Zm8=')
    expect(bytesToBase64(ascii('foo'))).toBe('Zm9v')
    expect(bytesToBase64(ascii('foob'))).toBe('Zm9vYg==')
    expect(bytesToBase64(ascii('fooba'))).toBe('Zm9vYmE=')
    expect(bytesToBase64(ascii('foobar'))).toBe('Zm9vYmFy')
  })

  it('デコードも RFC 4648 のテストベクタと一致する', () => {
    expect(base64ToBytes('')).toEqual(ascii(''))
    expect(base64ToBytes('Zg==')).toEqual(ascii('f'))
    expect(base64ToBytes('Zm8=')).toEqual(ascii('fo'))
    expect(base64ToBytes('Zm9v')).toEqual(ascii('foo'))
    expect(base64ToBytes('Zm9vYg==')).toEqual(ascii('foob'))
    expect(base64ToBytes('Zm9vYmE=')).toEqual(ascii('fooba'))
    expect(base64ToBytes('Zm9vYmFy')).toEqual(ascii('foobar'))
  })

  it('端数(1・2・3バイト)が往復で完全に一致する', () => {
    for (const source of [bytes(), bytes(0), bytes(0, 255), bytes(1, 2, 3), bytes(255, 254, 253, 252)]) {
      expect(base64ToBytes(bytesToBase64(source))).toEqual(source)
    }
  })

  it('0〜255 の全バイト値が往復で保たれる(JPEGのようなバイナリを想定)', () => {
    const source = new Uint8Array(256)
    for (let i = 0; i < 256; i++) source[i] = i
    const encoded = bytesToBase64(source)
    expect(encoded).toMatch(/^[A-Za-z0-9+/]+={0,2}$/)
    expect(base64ToBytes(encoded)).toEqual(source)
  })

  it('チャンク境界をまたぐ大きめのデータでも往復で一致する(写真1枚相当)', () => {
    // 200KB 相当の擬似ランダムデータ(内部の分割処理 3KB 単位をまたぐ)
    const source = new Uint8Array(200 * 1024)
    let seed = 12345
    for (let i = 0; i < source.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      source[i] = seed & 0xff
    }
    const encoded = bytesToBase64(source)
    expect(encoded).not.toContain('\n')
    expect(base64ToBytes(encoded)).toEqual(source)
  })

  it('JPEG のシグネチャ(FF D8 FF)が壊れずに往復する', () => {
    const jpeg = bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9)
    const restored = base64ToBytes(bytesToBase64(jpeg))
    expect(restored).toEqual(jpeg)
    expect([restored[0], restored[1], restored[2]]).toEqual([0xff, 0xd8, 0xff])
  })

  it('改行・空白入りの Base64 も読める(整形されたJSONからの復元)', () => {
    expect(base64ToBytes('Zm9v\nYmFy')).toEqual(ascii('foobar'))
    expect(base64ToBytes('  Zm9vYmFy  ')).toEqual(ascii('foobar'))
  })
})

describe('base64ToBytes(不正入力)', () => {
  it('Base64 に使えない文字はエラー', () => {
    expect(() => base64ToBytes('Zm9v*Yg==')).toThrow(Base64Error)
    expect(() => base64ToBytes('日本語')).toThrow(Base64Error)
  })

  it('長さが不正(4で割った余りが1)ならエラー', () => {
    expect(() => base64ToBytes('Zm9vY')).toThrow(Base64Error)
  })

  it('パディングが途中にある場合はエラー', () => {
    expect(() => base64ToBytes('Zm=9vYg==')).toThrow(Base64Error)
  })

  it('文字列以外はエラー', () => {
    expect(() => base64ToBytes(undefined as unknown as string)).toThrow(Base64Error)
  })
})

describe('base64Length(サイズ見積もり)', () => {
  it('Base64 化後の文字数を返す(約4/3倍)', () => {
    expect(base64Length(0)).toBe(0)
    expect(base64Length(1)).toBe(4)
    expect(base64Length(3)).toBe(4)
    expect(base64Length(4)).toBe(8)
    expect(base64Length(300 * 1024)).toBe(409_600)
  })

  it('実際のエンコード結果の長さと一致する', () => {
    for (const size of [1, 2, 3, 4, 5, 100, 1023]) {
      expect(base64Length(size)).toBe(bytesToBase64(new Uint8Array(size)).length)
    }
  })
})

describe('Data URL', () => {
  it('組み立てと分解が往復する', () => {
    const url = toDataUrl('image/jpeg', 'Zm9vYmFy')
    expect(url).toBe('data:image/jpeg;base64,Zm9vYmFy')
    expect(parseDataUrl(url)).toEqual({ mimeType: 'image/jpeg', base64: 'Zm9vYmFy' })
  })

  it('Base64 でない Data URL・通常のURLはエラー', () => {
    expect(() => parseDataUrl('data:image/jpeg,rawtext')).toThrow(Base64Error)
    expect(() => parseDataUrl('https://example.com/a.jpg')).toThrow(Base64Error)
  })
})
