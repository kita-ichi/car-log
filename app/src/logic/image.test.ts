/**
 * 愛車の写真(F-22)— 画像処理の純粋関数のテスト
 * - fitWithin: 縮小・拡大しない・アスペクト比維持・極端な縦横比・不正値
 * - assertProcessableImage: 画像以外 / SVG / 空 / 上限超過
 * - formatByteSize: 表示整形
 */
import { describe, expect, it } from 'vitest'
import {
  ImageError,
  MAX_PHOTO_EDGE,
  MAX_SOURCE_FILE_BYTES,
  assertProcessableImage,
  fitWithin,
  formatByteSize,
  needsDownscale,
} from './image'

describe('fitWithin(長辺を上限内に収める)', () => {
  it('横長の写真は長辺がちょうど上限になり、アスペクト比が保たれる', () => {
    // iPhone の標準的な横向き写真 4032x3024(4:3)
    expect(fitWithin(4032, 3024, 1280)).toEqual({ width: 1280, height: 960 })
  })

  it('縦長の写真でも長辺(高さ)が上限になる', () => {
    expect(fitWithin(3024, 4032, 1280)).toEqual({ width: 960, height: 1280 })
  })

  it('正方形は上限の正方形になる', () => {
    expect(fitWithin(2000, 2000, 1280)).toEqual({ width: 1280, height: 1280 })
  })

  it('上限より小さい画像は拡大しない(そのまま)', () => {
    expect(fitWithin(640, 480, 1280)).toEqual({ width: 640, height: 480 })
    expect(fitWithin(100, 50, 1280)).toEqual({ width: 100, height: 50 })
  })

  it('ちょうど上限サイズはそのまま(境界値)', () => {
    expect(fitWithin(1280, 720, 1280)).toEqual({ width: 1280, height: 720 })
    expect(fitWithin(720, 1280, 1280)).toEqual({ width: 720, height: 1280 })
  })

  it('上限を1px超えたら縮小する(境界値)', () => {
    expect(fitWithin(1281, 1281, 1280)).toEqual({ width: 1280, height: 1280 })
  })

  it('結果は必ず整数(canvas は整数ピクセルしか扱えない)', () => {
    const { width, height } = fitWithin(4000, 2251, 1280)
    expect(Number.isInteger(width)).toBe(true)
    expect(Number.isInteger(height)).toBe(true)
    expect(width).toBe(1280)
    expect(height).toBe(720) // 2251 * (1280/4000) = 720.32 → 720
  })

  it('極端に細長い画像でも短辺が 0 にならない(最低1px)', () => {
    expect(fitWithin(8000, 4, 1280)).toEqual({ width: 1280, height: 1 })
  })

  it('引数を省略すると既定の上限(MAX_PHOTO_EDGE)が使われる', () => {
    expect(MAX_PHOTO_EDGE).toBe(1280)
    expect(fitWithin(2560, 1440)).toEqual({ width: 1280, height: 720 })
  })

  it('幅・高さ・上限が正の有限数でなければエラー', () => {
    expect(() => fitWithin(0, 100, 1280)).toThrow(ImageError)
    expect(() => fitWithin(100, -1, 1280)).toThrow(ImageError)
    expect(() => fitWithin(Number.NaN, 100, 1280)).toThrow(ImageError)
    expect(() => fitWithin(100, Number.POSITIVE_INFINITY, 1280)).toThrow(ImageError)
    expect(() => fitWithin(100, 100, 0)).toThrow(ImageError)
  })
})

describe('needsDownscale', () => {
  it('上限を超える場合のみ true', () => {
    expect(needsDownscale(4032, 3024, 1280)).toBe(true)
    expect(needsDownscale(1280, 1280, 1280)).toBe(false)
    expect(needsDownscale(640, 480, 1280)).toBe(false)
  })
})

describe('assertProcessableImage(取り込み前の検査)', () => {
  it('通常の写真(JPEG・PNG・HEIC・WebP)は通る', () => {
    expect(() => assertProcessableImage({ type: 'image/jpeg', size: 3_500_000 })).not.toThrow()
    expect(() => assertProcessableImage({ type: 'image/png', size: 800_000 })).not.toThrow()
    expect(() => assertProcessableImage({ type: 'image/heic', size: 2_000_000 })).not.toThrow()
    expect(() => assertProcessableImage({ type: 'image/webp', size: 400_000 })).not.toThrow()
  })

  it('大文字の MIME タイプでも通る', () => {
    expect(() => assertProcessableImage({ type: 'IMAGE/JPEG', size: 1000 })).not.toThrow()
  })

  it('画像以外のファイルは not_an_image で弾く', () => {
    expect(() => assertProcessableImage({ type: 'application/pdf', size: 1000 })).toThrow(ImageError)
    try {
      assertProcessableImage({ type: 'video/mp4', size: 1000 })
      expect.unreachable('エラーが投げられるはず')
    } catch (e) {
      expect((e as ImageError).code).toBe('not_an_image')
      expect((e as ImageError).message).toContain('画像ファイル')
    }
  })

  it('MIME タイプ不明(空文字)も弾く', () => {
    try {
      assertProcessableImage({ type: '', size: 1000 })
      expect.unreachable('エラーが投げられるはず')
    } catch (e) {
      expect((e as ImageError).code).toBe('not_an_image')
    }
  })

  it('SVG は写真として扱わない(unsupported_type)', () => {
    try {
      assertProcessableImage({ type: 'image/svg+xml', size: 1000 })
      expect.unreachable('エラーが投げられるはず')
    } catch (e) {
      expect((e as ImageError).code).toBe('unsupported_type')
    }
  })

  it('空ファイルは empty で弾く', () => {
    try {
      assertProcessableImage({ type: 'image/jpeg', size: 0 })
      expect.unreachable('エラーが投げられるはず')
    } catch (e) {
      expect((e as ImageError).code).toBe('empty')
    }
  })

  it('20MB 超は too_large で弾き、メッセージにサイズが入る', () => {
    expect(MAX_SOURCE_FILE_BYTES).toBe(20 * 1024 * 1024)
    // 上限ちょうどは許容
    expect(() => assertProcessableImage({ type: 'image/jpeg', size: MAX_SOURCE_FILE_BYTES })).not.toThrow()
    try {
      assertProcessableImage({ type: 'image/jpeg', size: MAX_SOURCE_FILE_BYTES + 1 })
      expect.unreachable('エラーが投げられるはず')
    } catch (e) {
      expect((e as ImageError).code).toBe('too_large')
      expect((e as ImageError).message).toContain('20 MB')
    }
  })

  it('上限バイト数は引数で変えられる', () => {
    expect(() => assertProcessableImage({ type: 'image/jpeg', size: 5000 }, 1000)).toThrow(ImageError)
  })
})

describe('formatByteSize', () => {
  it('B / KB / MB を切り替えて整形する', () => {
    expect(formatByteSize(0)).toBe('0 B')
    expect(formatByteSize(512)).toBe('512 B')
    expect(formatByteSize(1024)).toBe('1.0 KB')
    expect(formatByteSize(320 * 1024)).toBe('320 KB')
    expect(formatByteSize(1024 * 1024)).toBe('1.0 MB')
    expect(formatByteSize(20 * 1024 * 1024)).toBe('20 MB')
  })

  it('不正値は「—」', () => {
    expect(formatByteSize(Number.NaN)).toBe('—')
    expect(formatByteSize(-1)).toBe('—')
  })
})
