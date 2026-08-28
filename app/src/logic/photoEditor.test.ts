/**
 * 写真調整シート(S-08a)の操作ロジックのテスト
 * - zoomRange / snapZoom / stepZoom / zoomLabel: スライダーの範囲・1.0スナップ・表示
 * - fitWholePhoto / fillFrame: プリセット(どちらも位置は中央)
 * - shouldHintPhotoAdjust: 発見性ヒントの判定(70%しきい値)
 * - panFocus / nudgeFocus: ドラッグ・矢印キーでの移動(はみ出す軸のみ・端でクランプ)
 * - zoomAround / pinchZoom: 注目点を保った拡大縮小
 */
import { describe, expect, it } from 'vitest'
import {
  FRAME_CENTER,
  HERO_FRAME,
  HINT_ZOOM_THRESHOLD,
  THUMB_FRAME,
  ZOOM_SNAP,
  ZOOM_STEP,
  canLabelBothNotches,
  fillFrame,
  fitWholePhoto,
  nudgeFocus,
  panFocus,
  pinchZoom,
  shouldHintPhotoAdjust,
  snapZoom,
  stepZoom,
  zoomAround,
  zoomLabel,
  zoomRange,
} from './photoEditor'
import { MAX_PHOTO_ZOOM, containZoom, photoLayout } from './photoAdjust'

/** 横向きのスマホ写真 4:3(16:9枠では containZoom = 0.75) */
const LANDSCAPE = { width: 1280, height: 960 }
/** 縦向きのスマホ写真 3:4(16:9枠では containZoom = 0.421875) */
const PORTRAIT = { width: 960, height: 1280 }
/** パノラマ 3:1 */
const PANORAMA = { width: 1280, height: 427 }

/** 編集枠の実寸(375px幅の端末で 16:9) */
const FRAME_PX = { width: 343, height: 193 }

const layoutOf = (image: { width: number; height: number }, adjust: unknown) =>
  photoLayout(image, HERO_FRAME, adjust as never)

describe('zoomRange(スライダーの範囲)', () => {
  it('下限は写真全体が収まる倍率(containZoom)になる', () => {
    expect(zoomRange(LANDSCAPE, HERO_FRAME).min).toBeCloseTo(0.75, 10)
    expect(zoomRange(PORTRAIT, HERO_FRAME).min).toBeCloseTo(containZoom(PORTRAIT, HERO_FRAME), 10)
    expect(zoomRange(PORTRAIT, HERO_FRAME).min).toBeCloseTo(0.421875, 10)
  })

  it('上限は MAX_PHOTO_ZOOM(3.0)', () => {
    expect(zoomRange(LANDSCAPE, HERO_FRAME).max).toBe(MAX_PHOTO_ZOOM)
  })

  it('枠と同じ比の写真は下限が 1(縮小しても余白が出ない=これ以上縮める意味がない)', () => {
    expect(zoomRange({ width: 1280, height: 720 }, HERO_FRAME).min).toBeCloseTo(1, 10)
  })

  it('写真の実寸が不明なときは下限 1(描画に反映できない縮小をUIで許さない)', () => {
    expect(zoomRange(null, HERO_FRAME).min).toBe(1)
    expect(zoomRange({ width: 1280 }, HERO_FRAME).min).toBe(1)
  })

  it('44pxサムネ枠(1:1)でも同じ規則で下限が決まる', () => {
    expect(zoomRange(PORTRAIT, THUMB_FRAME).min).toBeCloseTo(0.75, 10)
  })
})

describe('snapZoom(範囲クランプ + 1.0スナップ)', () => {
  const min = 0.421875

  it('1.0 の ±0.02 以内は 1.0 ちょうどに吸着する(余白ゼロに戻せること)', () => {
    expect(snapZoom(0.99, min)).toBe(1)
    expect(snapZoom(1.02, min)).toBe(1)
    expect(snapZoom(1 - ZOOM_SNAP, min)).toBe(1)
  })

  it('スナップ幅の外側はそのまま', () => {
    expect(snapZoom(1.03, min)).toBeCloseTo(1.03, 10)
    expect(snapZoom(0.97, min)).toBeCloseTo(0.97, 10)
  })

  it('下限・上限でクランプされる', () => {
    expect(snapZoom(0.1, min)).toBeCloseTo(min, 10)
    expect(snapZoom(99, min)).toBe(MAX_PHOTO_ZOOM)
  })

  it('下限が 1.0 に近い写真ではスナップよりクランプが優先される(下限を割らない)', () => {
    // 枠とほぼ同じ比 → 下限 0.99。0.985 はスナップ候補だがクランプで 0.99 に止まる
    expect(snapZoom(0.985, 0.99)).toBe(1)
    expect(snapZoom(0.9, 0.99)).toBeCloseTo(0.99, 10)
  })

  it('数値でない値は下限を返す(壊れた入力でUIを壊さない)', () => {
    expect(snapZoom(Number.NaN, min)).toBe(min)
  })
})

describe('stepZoom(−/+ ボタン)', () => {
  it('±5% 動く', () => {
    expect(stepZoom(1.5, ZOOM_STEP, 0.42)).toBeCloseTo(1.55, 10)
    expect(stepZoom(1.5, -ZOOM_STEP, 0.42)).toBeCloseTo(1.45, 10)
  })

  it('1.0 をまたぐときは 1.0 に吸着する', () => {
    expect(stepZoom(0.98, ZOOM_STEP, 0.42)).toBe(1)
    expect(stepZoom(1.03, -ZOOM_STEP, 0.42)).toBe(1)
  })

  it('境界では下限・上限にちょうど止まる', () => {
    expect(stepZoom(0.44, -ZOOM_STEP, 0.421875)).toBeCloseTo(0.421875, 10)
    expect(stepZoom(2.98, ZOOM_STEP, 0.42)).toBe(MAX_PHOTO_ZOOM)
  })
})

describe('zoomLabel(現在値の表示・aria-valuetext)', () => {
  it('下限に達したときだけ「全体」', () => {
    expect(zoomLabel(0.421875, 0.421875)).toBe('全体')
    expect(zoomLabel(0.43, 0.421875)).toBe('43%')
  })

  it('枠いっぱい=100%・拡大は%表示', () => {
    expect(zoomLabel(1, 0.42)).toBe('100%')
    expect(zoomLabel(1.2, 0.42)).toBe('120%')
    expect(zoomLabel(3, 0.42)).toBe('300%')
  })
})

describe('canLabelBothNotches(ノッチのラベルを2つ置けるか)', () => {
  it('縦写真(下限0.42)は2つのノッチが十分離れているので両方出す', () => {
    // (1 − 0.421875) ÷ (3 − 0.421875) = 22% 離れる
    expect(canLabelBothNotches(zoomRange(PORTRAIT, HERO_FRAME))).toBe(true)
  })

  it('横4:3(下限0.75)は近すぎるので「枠いっぱい」だけにする', () => {
    // (1 − 0.75) ÷ (3 − 0.75) = 11% しか離れず、375px幅でラベルが重なる
    expect(canLabelBothNotches(zoomRange(LANDSCAPE, HERO_FRAME))).toBe(false)
    expect(canLabelBothNotches(zoomRange(PANORAMA, HERO_FRAME))).toBe(false)
  })

  it('下限が1(縮小できない)なら片方だけ', () => {
    expect(canLabelBothNotches({ min: 1, max: 3 })).toBe(false)
  })
})

describe('プリセット(5.15.7: どちらも位置を中央に戻す)', () => {
  it('「全体を表示」は全体が収まる倍率+中央', () => {
    expect(fitWholePhoto(PORTRAIT, HERO_FRAME)).toEqual({
      zoom: containZoom(PORTRAIT, HERO_FRAME),
      focusX: 0.5,
      focusY: 0.5,
    })
  })

  it('「全体を表示」の結果は枠に余白が出るが、写真は枠内に完全に収まる', () => {
    const layout = layoutOf(PORTRAIT, fitWholePhoto(PORTRAIT, HERO_FRAME))!
    expect(layout.widthRatio).toBeLessThanOrEqual(1 + 1e-9)
    expect(layout.heightRatio).toBeCloseTo(1, 9) // 長い方の辺が枠にぴったり
    expect(layout.hasGapX).toBe(true)
    expect(layout.hasGapY).toBe(false)
  })

  it('「枠いっぱいに戻す」は既定値(cover + center)', () => {
    expect(fillFrame()).toEqual({ zoom: 1, focusX: 0.5, focusY: 0.5 })
  })
})

describe('shouldHintPhotoAdjust(発見性ヒントの判定)', () => {
  it('縦写真・パノラマでは出す(既定で70%未満しか映らない)', () => {
    expect(shouldHintPhotoAdjust(PORTRAIT, HERO_FRAME)).toBe(true)
    expect(shouldHintPhotoAdjust(PANORAMA, HERO_FRAME)).toBe(true)
  })

  it('横4:3(0.75)では出さない — 不具合ではなく仕様なので煽らない', () => {
    expect(shouldHintPhotoAdjust(LANDSCAPE, HERO_FRAME)).toBe(false)
    expect(containZoom(LANDSCAPE, HERO_FRAME)).toBeGreaterThanOrEqual(HINT_ZOOM_THRESHOLD)
  })

  it('枠と同じ比(全部映る)では出さない', () => {
    expect(shouldHintPhotoAdjust({ width: 1280, height: 720 }, HERO_FRAME)).toBe(false)
  })

  it('実寸不明では出さない(判定できないものを断定しない)', () => {
    expect(shouldHintPhotoAdjust(undefined, HERO_FRAME)).toBe(false)
  })
})

describe('panFocus(ドラッグでの移動)', () => {
  const base = { zoom: 1, focusX: 0.5, focusY: 0.5 }

  it('はみ出している軸だけ動く(4:3写真×16:9枠 = 縦のみはみ出す)', () => {
    const layout = layoutOf(LANDSCAPE, base)
    const moved = panFocus(base, layout, FRAME_PX, 40, -20)
    expect(moved.focusX).toBe(0.5) // 横は枠ぴったり = 動かない
    expect(moved.focusY).toBeGreaterThan(0.5) // 上へドラッグ = 写真の下側が見える
  })

  it('移動量は Δfocus = −Δpx ÷ (描画長 − 枠長)', () => {
    const layout = layoutOf(LANDSCAPE, base)!
    const overflowY = (layout.heightRatio - 1) * FRAME_PX.height
    const moved = panFocus(base, layout, FRAME_PX, 0, -10)
    expect(moved.focusY).toBeCloseTo(0.5 + 10 / overflowY, 10)
  })

  it('端でクランプされ、0〜1 を出ない(引っぱりすぎても余白は出ない)', () => {
    // 縦写真は縦にはみ出す / パノラマは横にはみ出す
    const portrait = layoutOf(PORTRAIT, base)
    expect(panFocus(base, portrait, FRAME_PX, 0, -9999).focusY).toBe(1)
    expect(panFocus(base, portrait, FRAME_PX, 0, 9999).focusY).toBe(0)
    const panorama = layoutOf(PANORAMA, base)
    expect(panFocus(base, panorama, FRAME_PX, -9999, 0).focusX).toBe(1)
    expect(panFocus(base, panorama, FRAME_PX, 9999, 0).focusX).toBe(0)
  })

  it('縦写真では横に動かせない(はみ出していない軸は反応しない)', () => {
    const moved = panFocus(base, layoutOf(PORTRAIT, base), FRAME_PX, 60, 0)
    expect(moved.focusX).toBe(0.5)
  })

  it('縮小して収まっている軸は動かない(中央固定)', () => {
    const shrunk = { zoom: containZoom(PORTRAIT, HERO_FRAME), focusX: 0.5, focusY: 0.5 }
    const layout = layoutOf(PORTRAIT, shrunk)
    const moved = panFocus(shrunk, layout, FRAME_PX, 50, 50)
    expect(moved).toEqual(shrunk)
  })

  it('描画ボックスが計算できない(実寸不明)ときは動かない', () => {
    expect(panFocus(base, null, FRAME_PX, 50, 50)).toEqual(base)
  })

  it('拡大時は両軸とも動く', () => {
    const zoomed = { zoom: 2, focusX: 0.5, focusY: 0.5 }
    const moved = panFocus(zoomed, layoutOf(LANDSCAPE, zoomed), FRAME_PX, -30, -30)
    expect(moved.focusX).toBeGreaterThan(0.5)
    expect(moved.focusY).toBeGreaterThan(0.5)
    expect(moved.zoom).toBe(2)
  })
})

describe('nudgeFocus(矢印キーでの移動)', () => {
  it('注視点を割合で動かす(1%/10%)', () => {
    expect(nudgeFocus({ zoom: 1, focusX: 0.5, focusY: 0.5 }, 0.01, 0)).toEqual({
      zoom: 1,
      focusX: 0.51,
      focusY: 0.5,
    })
    expect(nudgeFocus({ zoom: 1, focusX: 0.5, focusY: 0.5 }, 0, -0.1).focusY).toBeCloseTo(0.4, 10)
  })

  it('0〜1 でクランプされる', () => {
    expect(nudgeFocus({ zoom: 1, focusX: 0.99, focusY: 0.01 }, 0.1, -0.1)).toEqual({
      zoom: 1,
      focusX: 1,
      focusY: 0,
    })
  })
})

describe('zoomAround(注目点を保った拡大縮小)', () => {
  it('枠の中心にある写真上の点は、倍率を変えても中心に残る', () => {
    const start = { zoom: 1.2, focusX: 0.2, focusY: 0.8 }
    const before = layoutOf(PORTRAIT, start)!
    // 中心(0.5)にある写真上の正規化位置
    const uY = (0.5 - before.topRatio) / before.heightRatio

    const next = zoomAround(start, PORTRAIT, HERO_FRAME, 2, FRAME_CENTER)
    const after = layoutOf(PORTRAIT, next)!
    // 注視点は小数6桁に丸めて保存されるため、ごく僅かなズレは許容する
    expect(after.topRatio + uY * after.heightRatio).toBeCloseTo(0.5, 5)
  })

  it('中点を指定すればその点が保たれる(ピンチ用)', () => {
    const start = { zoom: 1, focusX: 0.5, focusY: 0.5 }
    const anchor = { x: 0.25, y: 0.75 }
    const before = layoutOf(PORTRAIT, start)!
    const uY = (anchor.y - before.topRatio) / before.heightRatio

    const next = zoomAround(start, PORTRAIT, HERO_FRAME, 1.8, anchor)
    const after = layoutOf(PORTRAIT, next)!
    expect(after.topRatio + uY * after.heightRatio).toBeCloseTo(anchor.y, 5)
  })

  it('縮小して収まる軸では注視点を保持する(拡大に戻すと元の構図へ復帰できる)', () => {
    const start = { zoom: 1.5, focusX: 0.2, focusY: 0.3 }
    const shrunk = zoomAround(start, LANDSCAPE, HERO_FRAME, 0.75)
    expect(shrunk.focusY).toBe(0.3) // 収まった軸は据え置き
    expect(shrunk.zoom).toBe(0.75)
  })

  it('注視点は 0〜1 に収まる(枠外に余白を作らない)', () => {
    const start = { zoom: 3, focusX: 0, focusY: 1 }
    const next = zoomAround(start, PORTRAIT, HERO_FRAME, 1.05, { x: 1, y: 0 })
    expect(next.focusX).toBeGreaterThanOrEqual(0)
    expect(next.focusX).toBeLessThanOrEqual(1)
    expect(next.focusY).toBeGreaterThanOrEqual(0)
    expect(next.focusY).toBeLessThanOrEqual(1)
  })

  it('実寸不明なら倍率だけ変える', () => {
    expect(zoomAround({ zoom: 1, focusX: 0.4, focusY: 0.6 }, null, HERO_FRAME, 2)).toEqual({
      zoom: 2,
      focusX: 0.4,
      focusY: 0.6,
    })
  })
})

describe('pinchZoom(補助操作)', () => {
  const range = { min: containZoom(PORTRAIT, HERO_FRAME), max: MAX_PHOTO_ZOOM }

  it('指の距離の比がそのまま倍率になる', () => {
    const start = { zoom: 1, focusX: 0.5, focusY: 0.5 }
    const next = pinchZoom(start, PORTRAIT, HERO_FRAME, 100, 150, FRAME_CENTER, range)
    expect(next.zoom).toBeCloseTo(1.5, 10)
  })

  it('範囲外にはならず、1.0 へのスナップも効く', () => {
    const start = { zoom: 1, focusX: 0.5, focusY: 0.5 }
    expect(pinchZoom(start, PORTRAIT, HERO_FRAME, 100, 1000, FRAME_CENTER, range).zoom).toBe(
      MAX_PHOTO_ZOOM,
    )
    expect(pinchZoom(start, PORTRAIT, HERO_FRAME, 100, 10, FRAME_CENTER, range).zoom).toBeCloseTo(
      range.min,
      10,
    )
    expect(pinchZoom(start, PORTRAIT, HERO_FRAME, 100, 101, FRAME_CENTER, range).zoom).toBe(1)
  })

  it('距離が 0 の異常値では変化しない', () => {
    const start = { zoom: 1.4, focusX: 0.3, focusY: 0.3 }
    expect(pinchZoom(start, PORTRAIT, HERO_FRAME, 0, 120, FRAME_CENTER, range)).toEqual(start)
  })
})
