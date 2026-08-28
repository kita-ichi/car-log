/**
 * 愛車の写真(F-22b)— 表示調整の純粋関数のテスト
 * - coverScale / containScale / containZoom: 横長・縦長・正方形 × 横長枠・正方形枠
 * - normalizePhotoAdjust / isDefaultPhotoAdjust: 欠損・不正値・クランプ
 * - photoLayout: 既定値が cover + center と一致すること・注視点のクランプ境界・
 *   縮小時の余白と中央寄せ・極端な拡大率
 * - photoBoxStyle / photoFrameStyle: CSS 値への変換
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PHOTO_ADJUST,
  MAX_PHOTO_ZOOM,
  MIN_PHOTO_ZOOM,
  clampPhotoAdjust,
  containScale,
  containZoom,
  coverScale,
  isDefaultPhotoAdjust,
  normalizePhotoAdjust,
  photoBoxStyle,
  photoFrameStyle,
  photoLayout,
  withMinZoom,
} from './photoAdjust'

/* 枠は比だけが意味を持つ(実ピクセルでなくてよい) */
/** ホームのヒーロー / 写真ピッカーのプレビュー(--ph-hero-ar: 16/9) */
const HERO = { width: 16, height: 9 }
/** 一覧・切り替えシートの44pxサムネイル */
const THUMB = { width: 44, height: 44 }

/* 保存される写真は長辺1280pxのJPEG(logic/image.ts) */
/** 横向きのスマホ写真 4:3 */
const LANDSCAPE = { width: 1280, height: 960 }
/** 縦向きのスマホ写真 3:4 */
const PORTRAIT = { width: 960, height: 1280 }
const SQUARE = { width: 1280, height: 1280 }

/** 描画ボックスを枠座標(枠幅=frame.width)に戻す。人が検算しやすい形にする */
function box(layout: NonNullable<ReturnType<typeof photoLayout>>, frame: { width: number; height: number }) {
  return {
    left: layout.leftRatio * frame.width,
    top: layout.topRatio * frame.height,
    width: layout.widthRatio * frame.width,
    height: layout.heightRatio * frame.height,
  }
}

describe('coverScale / containScale(枠を覆う / 枠に収まる倍率)', () => {
  it('横長写真 × 横長枠: cover は幅、contain は高さが枠に一致する', () => {
    // 16:9 の枠に 4:3 の写真。枠の方が横長なので幅を合わせると上下がはみ出す
    expect(LANDSCAPE.width * coverScale(LANDSCAPE, HERO)).toBeCloseTo(HERO.width, 10)
    expect(LANDSCAPE.height * containScale(LANDSCAPE, HERO)).toBeCloseTo(HERO.height, 10)
  })

  it('縦長写真 × 正方形枠: cover は幅、contain は高さが枠に一致する', () => {
    expect(PORTRAIT.width * coverScale(PORTRAIT, THUMB)).toBeCloseTo(THUMB.width, 10)
    expect(PORTRAIT.height * containScale(PORTRAIT, THUMB)).toBeCloseTo(THUMB.height, 10)
  })

  it('縦横比が枠と同じなら cover と contain が一致する', () => {
    expect(coverScale(SQUARE, THUMB)).toBeCloseTo(containScale(SQUARE, THUMB), 10)
    expect(containZoom(SQUARE, THUMB)).toBeCloseTo(1, 10)
  })

  it('contain は常に cover 以下(= containZoom は 1 以下)', () => {
    for (const image of [LANDSCAPE, PORTRAIT, SQUARE]) {
      for (const frame of [HERO, THUMB]) {
        expect(containScale(image, frame)).toBeLessThanOrEqual(coverScale(image, frame))
        expect(containZoom(image, frame)).toBeLessThanOrEqual(1)
      }
    }
  })

  it('containZoom は枠ごとに違う(同じ写真でもヒーローと44pxサムネで値が変わる)', () => {
    // 3:4 の縦写真: 16:9 枠では 0.421875、1:1 枠では 0.75
    expect(containZoom(PORTRAIT, HERO)).toBeCloseTo(0.421875, 10)
    expect(containZoom(PORTRAIT, THUMB)).toBeCloseTo(3 / 4, 10)
  })

  it('枠の絶対サイズではなく比だけで決まる(44px でも 4400px でも同じ)', () => {
    expect(containZoom(LANDSCAPE, { width: 44, height: 44 })).toBeCloseTo(
      containZoom(LANDSCAPE, { width: 4400, height: 4400 }),
      10,
    )
  })

  it('どの写真でも contain に届く倍率が MIN_PHOTO_ZOOM 以上にある(縮小要望を満たせる)', () => {
    // 極端な例: 超横長パノラマ(6.4:1)・超縦長(1:6.4)も想定に入れる
    const extremes = [LANDSCAPE, PORTRAIT, SQUARE, { width: 1280, height: 200 }, { width: 200, height: 1280 }]
    for (const image of extremes) {
      for (const frame of [HERO, THUMB]) {
        expect(containZoom(image, frame)).toBeGreaterThanOrEqual(MIN_PHOTO_ZOOM)
      }
    }
  })

  it('MIN_PHOTO_ZOOM は縦横比が20倍違うところまで縮小しきれる下限', () => {
    // 16:9 の枠に 1:11.2 の超縦長写真 = 縦横比の差がほぼ20倍
    expect(containZoom({ width: 114, height: 1280 }, HERO)).toBeGreaterThanOrEqual(MIN_PHOTO_ZOOM)
  })
})

describe('normalizePhotoAdjust(読み出しの正規化)', () => {
  it('未設定(undefined / null)は既定値 = cover + center', () => {
    expect(normalizePhotoAdjust(undefined)).toEqual({ zoom: 1, focusX: 0.5, focusY: 0.5 })
    expect(normalizePhotoAdjust(null)).toEqual(DEFAULT_PHOTO_ADJUST)
  })

  it('既定値を書き換えない(戻り値は毎回新しいオブジェクト)', () => {
    const result = normalizePhotoAdjust(undefined)
    result.zoom = 3
    expect(DEFAULT_PHOTO_ADJUST.zoom).toBe(1)
  })

  it('正しい値はそのまま通る', () => {
    expect(normalizePhotoAdjust({ zoom: 1.8, focusX: 0.2, focusY: 0.9 })).toEqual({
      zoom: 1.8,
      focusX: 0.2,
      focusY: 0.9,
    })
  })

  it('一部のキーだけある場合は残りを既定値で埋める', () => {
    expect(normalizePhotoAdjust({ zoom: 2 })).toEqual({ zoom: 2, focusX: 0.5, focusY: 0.5 })
    expect(normalizePhotoAdjust({ focusY: 0 })).toEqual({ zoom: 1, focusX: 0.5, focusY: 0 })
  })

  it('範囲外はクランプする(拡大率は MIN〜MAX、注視点は 0〜1)', () => {
    expect(normalizePhotoAdjust({ zoom: 99, focusX: 5, focusY: -3 })).toEqual({
      zoom: MAX_PHOTO_ZOOM,
      focusX: 1,
      focusY: 0,
    })
    expect(normalizePhotoAdjust({ zoom: 0 }).zoom).toBe(MIN_PHOTO_ZOOM)
  })

  it('NaN・Infinity・数値でない値は既定値に戻す(壊れたデータで表示が崩れない)', () => {
    expect(normalizePhotoAdjust({ zoom: NaN, focusX: Infinity })).toEqual(DEFAULT_PHOTO_ADJUST)
    expect(normalizePhotoAdjust({ zoom: '2' } as unknown as { zoom: number })).toEqual(DEFAULT_PHOTO_ADJUST)
    expect(normalizePhotoAdjust('x' as unknown as null)).toEqual(DEFAULT_PHOTO_ADJUST)
  })

  it('小数は保存桁数(6桁)に丸める', () => {
    expect(normalizePhotoAdjust({ focusX: 0.123456789 }).focusX).toBe(0.123457)
  })

  it('「写真全体が収まる倍率」を丸めても隙間にならない精度がある', () => {
    // containZoom は 0.421875 のように4桁では表せない値になる(6桁なら誤差ゼロ)
    expect(normalizePhotoAdjust({ zoom: containZoom(PORTRAIT, HERO) }).zoom).toBe(0.421875)
  })

  it('clampPhotoAdjust は同じ正規化(UI がドラッグ途中の値を保存前に通す用)', () => {
    expect(clampPhotoAdjust({ zoom: 10, focusX: 1.4, focusY: 0.5 })).toEqual({
      zoom: MAX_PHOTO_ZOOM,
      focusX: 1,
      focusY: 0.5,
    })
  })
})

describe('isDefaultPhotoAdjust(調整なしの判定)', () => {
  it('未設定・既定値と同じ値は true', () => {
    expect(isDefaultPhotoAdjust(undefined)).toBe(true)
    expect(isDefaultPhotoAdjust({ zoom: 1, focusX: 0.5, focusY: 0.5 })).toBe(true)
  })

  it('どれか1つでも違えば false', () => {
    expect(isDefaultPhotoAdjust({ zoom: 1.2, focusX: 0.5, focusY: 0.5 })).toBe(false)
    expect(isDefaultPhotoAdjust({ zoom: 1, focusX: 0.4, focusY: 0.5 })).toBe(false)
    expect(isDefaultPhotoAdjust({ zoom: 1, focusX: 0.5, focusY: 0.51 })).toBe(false)
  })

  it('クランプ後に既定値と同じになる値も true(zoom だけ範囲外の壊れた値など)', () => {
    expect(isDefaultPhotoAdjust({ zoom: NaN, focusX: 0.5, focusY: 0.5 })).toBe(true)
  })
})

describe('photoLayout: 既定値は object-fit: cover + center と一致する', () => {
  it('横長写真 × 16:9 ヒーロー: 幅が枠ぴったり、上下が均等にはみ出す', () => {
    const layout = photoLayout(LANDSCAPE, HERO)!
    const { left, top, width, height } = box(layout, HERO)
    expect(width).toBeCloseTo(16, 10) // 短辺側(幅)が枠に一致 = cover
    expect(height).toBeCloseTo(12, 10) // 1280:960 を保ったまま
    expect(left).toBeCloseTo(0, 10)
    expect(top).toBeCloseTo((9 - 12) / 2, 10) // 上下均等にはみ出す = center
    expect(layout.hasGapX).toBe(false)
    expect(layout.hasGapY).toBe(false)
  })

  it('縦長写真 × 16:9 ヒーロー: 幅が枠ぴったりで上下に大きくはみ出す', () => {
    const { left, top, width, height } = box(photoLayout(PORTRAIT, HERO)!, HERO)
    expect(width).toBeCloseTo(16, 10)
    expect(height).toBeCloseTo(16 * (1280 / 960), 10)
    expect(left).toBeCloseTo(0, 10)
    expect(top).toBeCloseTo((9 - height) / 2, 10)
  })

  it('横長写真 × 正方形サムネ: 高さが枠ぴったりで左右が均等にはみ出す', () => {
    const { left, top, width, height } = box(photoLayout(LANDSCAPE, THUMB)!, THUMB)
    expect(height).toBeCloseTo(44, 10)
    expect(width).toBeCloseTo(44 * (1280 / 960), 10)
    expect(top).toBeCloseTo(0, 10)
    expect(left).toBeCloseTo((44 - width) / 2, 10)
  })

  it('縦長写真 × 正方形サムネ: 幅が枠ぴったりで上下が均等にはみ出す', () => {
    const { left, top, width, height } = box(photoLayout(PORTRAIT, THUMB)!, THUMB)
    expect(width).toBeCloseTo(44, 10)
    expect(top).toBeCloseTo((44 - height) / 2, 10)
    expect(left).toBeCloseTo(0, 10)
  })

  it('正方形写真 × 正方形サムネ: 枠と完全に一致する(はみ出しゼロ)', () => {
    const layout = photoLayout(SQUARE, THUMB)!
    expect(box(layout, THUMB)).toEqual({ left: 0, top: 0, width: 44, height: 44 })
    expect(layout.hasGapX).toBe(false)
    expect(layout.hasGapY).toBe(false)
  })

  it('正方形写真 × 16:9 ヒーロー: 幅が枠ぴったりで上下にはみ出す', () => {
    const { left, top, width, height } = box(photoLayout(SQUARE, HERO)!, HERO)
    expect(width).toBeCloseTo(16, 10)
    expect(height).toBeCloseTo(16, 10)
    expect(left).toBeCloseTo(0, 10)
    expect(top).toBeCloseTo((9 - 16) / 2, 10)
  })

  it('未設定・null・壊れた調整値でも既定値と同じ結果になる', () => {
    const base = photoLayout(LANDSCAPE, HERO)
    expect(photoLayout(LANDSCAPE, HERO, null)).toEqual(base)
    expect(photoLayout(LANDSCAPE, HERO, DEFAULT_PHOTO_ADJUST)).toEqual(base)
    expect(photoLayout(LANDSCAPE, HERO, { zoom: NaN })).toEqual(base)
  })

  it('既定値では描画ボックスが必ず枠を覆う(どの写真 × どの枠でも)', () => {
    for (const image of [LANDSCAPE, PORTRAIT, SQUARE]) {
      for (const frame of [HERO, THUMB]) {
        const layout = photoLayout(image, frame)!
        expect(layout.widthRatio).toBeGreaterThanOrEqual(1 - 1e-9)
        expect(layout.heightRatio).toBeGreaterThanOrEqual(1 - 1e-9)
        expect(layout.leftRatio).toBeLessThanOrEqual(1e-9)
        expect(layout.topRatio).toBeLessThanOrEqual(1e-9)
      }
    }
  })
})

describe('photoLayout: 注視点(位置調整)とクランプ', () => {
  it('縦長写真をヒーローで上寄せ(focusY=0)にすると写真の上端が枠の上端に来る', () => {
    // 「顔が切れる」を直す典型操作。クランプが効いて上に余白は出ない
    const { top } = box(photoLayout(PORTRAIT, HERO, { zoom: 1, focusX: 0.5, focusY: 0 })!, HERO)
    expect(top).toBeCloseTo(0, 10)
  })

  it('下寄せ(focusY=1)なら写真の下端が枠の下端に来る', () => {
    const { top, height } = box(photoLayout(PORTRAIT, HERO, { zoom: 1, focusX: 0.5, focusY: 1 })!, HERO)
    expect(top + height).toBeCloseTo(9, 10)
  })

  it('左端・右端(focusX=0 / 1)も枠の内側でクランプされる', () => {
    const left0 = box(photoLayout(LANDSCAPE, THUMB, { zoom: 1, focusX: 0, focusY: 0.5 })!, THUMB)
    expect(left0.left).toBeCloseTo(0, 10)
    const right = box(photoLayout(LANDSCAPE, THUMB, { zoom: 1, focusX: 1, focusY: 0.5 })!, THUMB)
    expect(right.left + right.width).toBeCloseTo(44, 10)
  })

  it('はみ出していない軸は注視点を動かしても位置が変わらない(クランプの境界)', () => {
    // 横長写真 × 16:9: 幅はぴったり枠と同じなので focusX は効かない
    const a = photoLayout(LANDSCAPE, HERO, { zoom: 1, focusX: 0, focusY: 0.5 })!
    const b = photoLayout(LANDSCAPE, HERO, { zoom: 1, focusX: 1, focusY: 0.5 })!
    expect(a.leftRatio).toBeCloseTo(0, 10)
    expect(b.leftRatio).toBeCloseTo(0, 10)
  })

  it('拡大しても枠の外に余白は出ない(どの注視点でも枠を覆い続ける)', () => {
    for (const focusX of [0, 0.25, 0.5, 0.75, 1]) {
      for (const focusY of [0, 0.5, 1]) {
        for (const zoom of [1, 1.5, MAX_PHOTO_ZOOM]) {
          const layout = photoLayout(PORTRAIT, HERO, { zoom, focusX, focusY })!
          expect(layout.leftRatio).toBeLessThanOrEqual(1e-9)
          expect(layout.topRatio).toBeLessThanOrEqual(1e-9)
          expect(layout.leftRatio + layout.widthRatio).toBeGreaterThanOrEqual(1 - 1e-9)
          expect(layout.topRatio + layout.heightRatio).toBeGreaterThanOrEqual(1 - 1e-9)
          expect(layout.hasGapX).toBe(false)
          expect(layout.hasGapY).toBe(false)
        }
      }
    }
  })

  it('注視点は CSS の object-position と同じ意味(はみ出し量に対する割合)', () => {
    // 縦長写真 × 16:9: 高さ 21.3333 が枠 9 からはみ出す = 余り -12.3333
    // focusY = 0.25 なら上端から余りの25%だけずらす
    const { top } = box(photoLayout(PORTRAIT, HERO, { zoom: 1, focusX: 0.5, focusY: 0.25 })!, HERO)
    const overflow = 16 * (1280 / 960) - 9
    expect(top).toBeCloseTo(-overflow * 0.25, 10)
  })

  it('注視点 0 → 0.5 → 1 で位置が単調に動く', () => {
    const tops = [0, 0.25, 0.5, 0.75, 1].map(
      (focusY) => photoLayout(PORTRAIT, HERO, { zoom: 1, focusX: 0.5, focusY })!.topRatio,
    )
    for (let i = 1; i < tops.length; i++) expect(tops[i]).toBeLessThan(tops[i - 1])
  })

  it('同じ調整値をヒーローとサムネの両方に適用できる(枠ごとに結果が変わるだけ)', () => {
    const adjust = { zoom: 1.4, focusX: 0.3, focusY: 0.2 }
    const hero = photoLayout(PORTRAIT, HERO, adjust)!
    const thumb = photoLayout(PORTRAIT, THUMB, adjust)!
    expect(hero.zoom).toBe(1.4)
    expect(thumb.zoom).toBe(1.4)
    // どちらの枠でも覆い続ける
    expect(hero.hasGapX || hero.hasGapY).toBe(false)
    expect(thumb.hasGapX || thumb.hasGapY).toBe(false)
  })
})

describe('photoLayout: 縮小(contain より小さいとき)', () => {
  it('containZoom ちょうどで写真全体が枠に収まる', () => {
    const zoom = containZoom(PORTRAIT, HERO)
    const layout = photoLayout(PORTRAIT, HERO, { zoom, focusX: 0.5, focusY: 0.5 })!
    const { left, top, width, height } = box(layout, HERO)
    expect(height).toBeCloseTo(9, 4) // 長辺(高さ)が枠にぴったり
    expect(width).toBeLessThan(16)
    expect(left).toBeGreaterThan(0) // 左右に余白
    expect(top).toBeCloseTo(0, 4)
    expect(layout.hasGapX).toBe(true)
    expect(layout.hasGapY).toBe(false)
  })

  it('containZoom を下回ると上下左右すべてに余白が出る(縮小できている)', () => {
    const layout = photoLayout(SQUARE, HERO, { zoom: 0.3, focusX: 0.5, focusY: 0.5 })!
    expect(layout.containZoom).toBeCloseTo(9 / 16, 10)
    expect(layout.widthRatio).toBeLessThan(1)
    expect(layout.heightRatio).toBeLessThan(1)
    expect(layout.hasGapX).toBe(true)
    expect(layout.hasGapY).toBe(true)
  })

  it('余白が出る軸は注視点を無視して中央に置く(端に寄せられない)', () => {
    const centered = photoLayout(SQUARE, HERO, { zoom: 0.3, focusX: 0.5, focusY: 0.5 })!
    const corner = photoLayout(SQUARE, HERO, { zoom: 0.3, focusX: 0, focusY: 1 })!
    expect(corner.leftRatio).toBeCloseTo(centered.leftRatio, 10)
    expect(corner.topRatio).toBeCloseTo(centered.topRatio, 10)
    // 余白は左右・上下で均等
    expect(corner.leftRatio).toBeCloseTo((1 - corner.widthRatio) / 2, 10)
    expect(corner.topRatio).toBeCloseTo((1 - corner.heightRatio) / 2, 10)
  })

  it('片方の軸だけ収まっている場合、その軸だけ中央・もう一方は注視点が効く', () => {
    // 4:3 写真 × 16:9 枠を zoom 0.8 にすると
    //   幅: 16 × 0.8 = 12.8 → 枠(16)に収まる = 左右に余白・中央固定
    //   高さ: 12 × 0.8 = 9.6 → 枠(9)からはみ出す = focusY が効く
    const at = (focusX: number, focusY: number) =>
      box(photoLayout(LANDSCAPE, HERO, { zoom: 0.8, focusX, focusY })!, HERO)

    const top = at(0, 0)
    expect(top.width).toBeCloseTo(12.8, 10)
    expect(top.height).toBeCloseTo(9.6, 10)
    expect(top.left).toBeCloseTo((16 - 12.8) / 2, 10) // 収まった軸は中央
    expect(top.top).toBeCloseTo(0, 10) // 上寄せ(クランプで枠上端まで)

    const bottom = at(1, 1)
    expect(bottom.left).toBeCloseTo(top.left, 10) // focusX は無視される
    expect(bottom.top + bottom.height).toBeCloseTo(9, 10) // 下寄せ

    const layout = photoLayout(LANDSCAPE, HERO, { zoom: 0.8, focusX: 0.5, focusY: 0.5 })!
    expect(layout.hasGapX).toBe(true)
    expect(layout.hasGapY).toBe(false)
  })

  it('下限まで縮小しても縦横比は保たれる', () => {
    const layout = photoLayout(LANDSCAPE, HERO, { zoom: MIN_PHOTO_ZOOM, focusX: 0.5, focusY: 0.5 })!
    const { width, height } = box(layout, HERO)
    expect(width / height).toBeCloseTo(1280 / 960, 10)
  })
})

describe('withMinZoom(44pxサムネイルは余白を作らない)', () => {
  it('縮小した調整値でも、サムネ用に通すと倍率が 1 に持ち上がる', () => {
    const shrunk = { zoom: 0.42, focusX: 0.3, focusY: 0.1 }
    expect(withMinZoom(shrunk, 1)).toEqual({ zoom: 1, focusX: 0.3, focusY: 0.1 })
  })

  it('拡大側はそのまま(位置も変えない)', () => {
    const zoomed = { zoom: 2.5, focusX: 0.3, focusY: 0.1 }
    expect(withMinZoom(zoomed, 1)).toEqual(zoomed)
  })

  it('ヒーローで全体表示まで縮小しても、サムネは写真で埋まる', () => {
    const adjust = { zoom: containZoom(PORTRAIT, HERO), focusX: 0.5, focusY: 0.2 }
    const hero = photoLayout(PORTRAIT, HERO, adjust)!
    const thumb = photoLayout(PORTRAIT, THUMB, withMinZoom(adjust, 1))!
    expect(hero.hasGapX).toBe(true) // ヒーローは余白あり(全体表示)
    expect(thumb.hasGapX).toBe(false) // サムネは埋まる
    expect(thumb.hasGapY).toBe(false)
  })

  it('未設定の調整値でも既定値として扱われる', () => {
    expect(withMinZoom(undefined, 1)).toEqual(DEFAULT_PHOTO_ADJUST)
  })
})

describe('photoLayout: 極端な入力', () => {
  it('最大倍率でも縦横比が保たれ、枠を覆い続ける', () => {
    const layout = photoLayout(LANDSCAPE, THUMB, { zoom: MAX_PHOTO_ZOOM, focusX: 0.5, focusY: 0.5 })!
    const { width, height } = box(layout, THUMB)
    expect(width / height).toBeCloseTo(1280 / 960, 10)
    expect(height).toBeCloseTo(44 * MAX_PHOTO_ZOOM, 10) // cover の4倍
    expect(layout.hasGapX).toBe(false)
  })

  it('範囲外の倍率は正規化されてから適用される(zoom が MAX を超えない)', () => {
    expect(photoLayout(LANDSCAPE, HERO, { zoom: 100 })!.zoom).toBe(MAX_PHOTO_ZOOM)
    expect(photoLayout(LANDSCAPE, HERO, { zoom: -5 })!.zoom).toBe(MIN_PHOTO_ZOOM)
  })

  it('極端に細長い写真でも計算できる(1280x1 のパノラマ)', () => {
    const layout = photoLayout({ width: 1280, height: 1 }, HERO)!
    expect(Number.isFinite(layout.widthRatio)).toBe(true)
    expect(layout.heightRatio).toBeCloseTo(1, 10) // cover は高さ側で決まる
  })

  it('写真の実寸が分からない場合は null(UI は従来の cover 表示にフォールバック)', () => {
    expect(photoLayout(undefined, HERO)).toBeNull()
    expect(photoLayout(null, HERO)).toBeNull()
    expect(photoLayout({ width: 1280 }, HERO)).toBeNull() // 高さが無い
    expect(photoLayout({ width: 0, height: 0 }, HERO)).toBeNull()
    expect(photoLayout({ width: NaN, height: 100 }, HERO)).toBeNull()
  })

  it('枠が不正な場合も null', () => {
    expect(photoLayout(LANDSCAPE, { width: 0, height: 9 })).toBeNull()
    expect(photoLayout(LANDSCAPE, null)).toBeNull()
  })
})

describe('photoBoxStyle / photoFrameStyle(CSS 値への変換)', () => {
  it('既定値の横長写真 × ヒーローは width:100% / left:0% になる', () => {
    // 4:3 写真を 16:9 枠へ: 高さ 12/9 = 133.3333%、上下均等に -16.6667%
    expect(photoFrameStyle(LANDSCAPE, HERO)).toEqual({
      width: '100%',
      height: '133.3333%',
      left: '0%',
      top: '-16.6667%',
    })
  })

  it('正方形写真 × 正方形サムネは枠と完全一致(4値とも 100% / 0%)', () => {
    expect(photoFrameStyle(SQUARE, THUMB)).toEqual({
      width: '100%',
      height: '100%',
      left: '0%',
      top: '0%',
    })
  })

  it('縮小時は width が 100% 未満・left が正のパーセントになる', () => {
    const style = photoFrameStyle(SQUARE, HERO, { zoom: 0.3, focusX: 0.5, focusY: 0.5 })!
    expect(parseFloat(style.width)).toBeLessThan(100)
    expect(parseFloat(style.left)).toBeGreaterThan(0)
    expect(parseFloat(style.top)).toBeGreaterThan(0)
  })

  it('実寸が分からない場合は null(呼び出し側が cover にフォールバックする合図)', () => {
    expect(photoFrameStyle(undefined, HERO)).toBeNull()
    expect(photoBoxStyle(null)).toBeNull()
  })

  it('すべての値が % 単位の文字列', () => {
    const style = photoFrameStyle(PORTRAIT, HERO, { zoom: 1.37, focusX: 0.31, focusY: 0.12 })!
    for (const value of Object.values(style)) {
      expect(value).toMatch(/^-?\d+(\.\d+)?%$/)
    }
  })
})
