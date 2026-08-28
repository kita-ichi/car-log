/**
 * 愛車の写真(F-22b)— 表示位置・拡大縮小の調整(純粋関数)
 * 参照: docs/要件定義書.md §5.1 Vehicle.photoAdjust / F-22 愛車の写真設定
 *
 * この層は DOM・React・DB に依存しない(計算のみ)。
 *
 * ## 解きたい問題
 * 写真はヒーロー(16:7)と44pxサムネイル(1:1)という**縦横比の違う枠**に出る。
 * どちらも `object-fit: cover` で中央を切り抜くため「写真の一部しか映らない」。
 * 写真そのものは再加工せず(非破壊)、**表示のたびに適用する調整値**で解決する。
 *
 * ## 調整値の表し方(枠に依存しない相対値)
 * - `zoom`: **その枠を覆う最小倍率(cover)を 1 とする相対値**。
 *   cover は枠ごとに計算されるので、同じ `zoom` を 16:9 の枠にも 1:1 の枠にも
 *   そのまま適用できる(`zoom: 1` はどちらの枠でも「ちょうど覆う」)
 * - `focusX` / `focusY`: **はみ出した分のどこを見せるか**(0〜1)。
 *   0 = 写真の左端(上端)を枠の端に合わせる / 1 = 右端(下端) / 0.5 = 中央。
 *   CSS の `object-position: focusX*100% focusY*100%` と同じ意味なので、
 *   はみ出し量が枠ごとに違っても 0〜1 がそのまま「端から端まで」に対応する
 *
 * 既定値 `{ zoom: 1, focusX: 0.5, focusY: 0.5 }` を入れると
 * `object-fit: cover; object-position: center` と**完全に同じ配置**になる
 * (`photoLayout()` のコメント参照)。値を持たない既存の写真は既定値として扱う。
 *
 * ## 枠より縮小したとき
 * `zoom` が `containZoom()`(写真全体が収まる倍率)を下回ると枠に余白が出る。
 * これは不具合ではなく「写真全体を見せたい」という要望そのものなので、
 * **余白が出る軸は注視点を無視して中央に置く**(端に寄せられると崩れて見えるため)。
 *
 * 対応する設計: docs/design/デザインガイド.md 5.15.6(保持する値と描画規則)
 */
import type { PhotoAdjust } from '../types/models'

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

/**
 * 調整なしの既定値。`object-fit: cover; object-position: center` と一致する。
 * **この値を変えてはいけない** — 変えると設定済みユーザーの見え方が勝手に変わる。
 */
export const DEFAULT_PHOTO_ADJUST: PhotoAdjust = { zoom: 1, focusX: 0.5, focusY: 0.5 }

/**
 * 保存を許す拡大率の下限。
 *
 * 「写真全体を枠に収める」のに必要な倍率は枠と写真の縦横比だけで決まり、
 * `containZoom = min(枠比/写真比, 写真比/枠比)`(`containZoom()`)。
 * つまりこの下限は「縦横比が枠と最大何倍まで違っても縮小しきれるか」を決めていて、
 * 0.05 なら **20倍** の違いまで許容する
 * (16:9 の枠なら 1:11 の超縦長写真〜35:1 の超横長パノラマまで全体を収められる)。
 *
 * UI のスライダー下限にはこの定数ではなく、その枠の `containZoom()` を使うこと
 * (それ以上縮めても余白が増えるだけで、見える範囲は変わらない)。
 */
export const MIN_PHOTO_ZOOM = 0.05

/**
 * 保存を許す拡大率の上限(デザインガイド `--ph-zoom-max`)。
 * 保存画像の長辺は 1280px(MAX_PHOTO_EDGE)なので、cover の3倍まで拡大すると
 * 元画像の1/3幅を引き伸ばすことになり、これ以上は実用的な画質にならない。
 */
export const MAX_PHOTO_ZOOM = 3

/**
 * 保存時に丸める小数桁数(JSONバックアップを無用に長くしないため)。
 *
 * 6桁ある理由: 「写真全体がちょうど収まる倍率」(`containZoom()`)は
 * 0.328125 のように4桁では表せない値になることがあり、丸めると枠との間に
 * わずかな隙間が残る。6桁なら残差は枠の 1/1,000,000 = 実質ゼロになる。
 */
const ADJUST_PRECISION = 6

/** 浮動小数の比較誤差(余白判定用) */
const EPSILON = 1e-9

// ---------------------------------------------------------------------------
// 寸法
// ---------------------------------------------------------------------------

/**
 * 幅・高さの組。**絶対値ではなく比だけが意味を持つ**ので、枠には
 * ピクセルでも `{ width: 16, height: 7 }` のような比でも渡してよい。
 */
export interface Size {
  width: number
  height: number
}

/** 幅・高さが未取得(VehiclePhoto.width/height は任意項目)でも受け取れる形 */
export type MaybeSize = { width?: number; height?: number } | null | undefined

const isPositive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0

/** 使える寸法なら Size、幅・高さが欠けている/不正なら null */
function toSize(value: MaybeSize): Size | null {
  if (!value || !isPositive(value.width) || !isPositive(value.height)) return null
  return { width: value.width, height: value.height }
}

/**
 * 枠**全体を覆う**最小倍率(= `object-fit: cover` の倍率)。
 * 写真の実寸に掛けると、短い方の辺がちょうど枠に一致する。
 */
export function coverScale(image: Size, frame: Size): number {
  return Math.max(frame.width / image.width, frame.height / image.height)
}

/**
 * 写真**全体が枠に収まる**最大倍率(= `object-fit: contain` の倍率)。
 * 写真の実寸に掛けると、長い方の辺がちょうど枠に一致する。
 */
export function containScale(image: Size, frame: Size): number {
  return Math.min(frame.width / image.width, frame.height / image.height)
}

/**
 * 写真全体が枠に収まる `zoom` の値(cover を 1 とする単位での contain)。
 *
 * 常に 1 以下で、写真と枠の縦横比が同じときだけ 1 になる。
 * **UI の縮小スライダーの下限はこの値にする** — これより小さくしても
 * 余白が増えるだけで、写真の見える範囲は変わらない。
 */
export function containZoom(image: Size, frame: Size): number {
  return containScale(image, frame) / coverScale(image, frame)
}

// ---------------------------------------------------------------------------
// 調整値の正規化・検証
// ---------------------------------------------------------------------------

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

const round = (value: number): number => Number(value.toFixed(ADJUST_PRECISION))

/**
 * 保存・表示に使える調整値へ正規化する。**読み出しは必ずこれを通す**。
 *
 * - `undefined` / `null` / 壊れた値 → 既定値(cover + center)= 従来どおりの見え方
 * - 一部のキーだけある場合 → 足りないキーは既定値で埋める
 * - 範囲外の数値 → 範囲内へクランプ(`zoom` は MIN〜MAX、注視点は 0〜1)
 */
export function normalizePhotoAdjust(value: Partial<PhotoAdjust> | null | undefined): PhotoAdjust {
  if (!value || typeof value !== 'object') return { ...DEFAULT_PHOTO_ADJUST }
  const pick = (raw: unknown, fallback: number, min: number, max: number): number =>
    typeof raw === 'number' && Number.isFinite(raw) ? round(clamp(raw, min, max)) : fallback
  return {
    zoom: pick(value.zoom, DEFAULT_PHOTO_ADJUST.zoom, MIN_PHOTO_ZOOM, MAX_PHOTO_ZOOM),
    focusX: pick(value.focusX, DEFAULT_PHOTO_ADJUST.focusX, 0, 1),
    focusY: pick(value.focusY, DEFAULT_PHOTO_ADJUST.focusY, 0, 1),
  }
}

/**
 * ドラッグ・ピンチの途中値を保存できる値に丸める(UI が保存前に通す)。
 * `normalizePhotoAdjust` と同じだが、意図が「クランプ」であることを名前で示す。
 */
export const clampPhotoAdjust = normalizePhotoAdjust

/**
 * 既定値(= 調整なし)と同じか。
 * リポジトリはこのとき `photoAdjust` を**保存しない**(キーを持たない状態に戻す)ので、
 * 「調整なし」の表現がDB上で1つに保たれる。
 */
export function isDefaultPhotoAdjust(value: Partial<PhotoAdjust> | null | undefined): boolean {
  const a = normalizePhotoAdjust(value)
  return (
    a.zoom === DEFAULT_PHOTO_ADJUST.zoom &&
    a.focusX === DEFAULT_PHOTO_ADJUST.focusX &&
    a.focusY === DEFAULT_PHOTO_ADJUST.focusY
  )
}

/**
 * 拡大率に下限を課した調整値を返す(位置はそのまま)。
 *
 * **44pxサムネイル用**(デザインガイド 5.15.6「2つの枠への適用」):
 * サムネイルは `withMinZoom(adjust, 1)` を通してから描画する。
 * 「どこを見せたいか」の意図は共有しつつ、識別が目的の小さな枠に余白を作らない
 * (ヒーローで全体表示まで縮小しても、サムネイルは常に写真で埋まる)。
 */
export function withMinZoom(
  adjust: Partial<PhotoAdjust> | null | undefined,
  minZoom: number,
): PhotoAdjust {
  const value = normalizePhotoAdjust(adjust)
  return value.zoom >= minZoom ? value : { ...value, zoom: minZoom }
}

// ---------------------------------------------------------------------------
// 表示計算
// ---------------------------------------------------------------------------

/**
 * 枠に対する写真の描画ボックス。すべて**枠のサイズに対する比**なので、
 * 枠の実ピクセル数を測らなくても CSS のパーセント指定にそのまま使える
 * (枠の縦横比さえ分かればよい = `aspect-ratio` で固定済みの枠と相性が良い)。
 */
export interface PhotoLayout {
  /** 描画幅 ÷ 枠幅(1 = 枠と同じ幅) */
  widthRatio: number
  /** 描画高さ ÷ 枠高さ */
  heightRatio: number
  /** 枠の左辺から描画左辺までの距離 ÷ 枠幅(負 = 枠の外へはみ出す) */
  leftRatio: number
  /** 枠の上辺から描画上辺までの距離 ÷ 枠高さ */
  topRatio: number
  /** 適用された拡大率(cover = 1) */
  zoom: number
  /** この枠で写真全体が収まる拡大率(UI のスライダー下限) */
  containZoom: number
  /** 左右に余白が出ているか(枠より縮小したとき true) */
  hasGapX: boolean
  /** 上下に余白が出ているか */
  hasGapY: boolean
}

/**
 * 1軸ぶんの配置を決める(デザインガイド 5.15.6 の描画規則)。
 *
 * - 描画長さが枠より**長い**(通常・拡大時): `offset = (枠長 - 描画長) × focus`。
 *   `枠長 - 描画長` は負なので、focus が 0〜1 である限り offset は
 *   `[枠長 - 描画長, 0]` に必ず収まる = **枠の外に余白が出ることは原理的に無い**
 *   (クランプ処理が要らないのがこの式の利点。focus の範囲は
 *   `normalizePhotoAdjust()` が保証する)
 * - 描画長さが枠**以下**(縮小して収まっている): はみ出しが無く focus に意味が
 *   無いので**中央に置く**(端に寄せられると崩れて見えるため)
 */
function placeAxis(
  frameLength: number,
  drawnLength: number,
  focus: number,
): { offset: number; gap: boolean } {
  const slack = frameLength - drawnLength
  if (drawnLength <= frameLength) {
    return { offset: slack / 2, gap: drawnLength + EPSILON < frameLength }
  }
  return { offset: slack * focus, gap: false }
}

/**
 * 調整値・写真の実寸・枠の縦横比から、実際の描画ボックスを求める。
 *
 * 写真の実寸が分からない場合(`VehiclePhoto.width/height` が無い古いレコード等)は
 * **null** を返す。呼び出し側は従来どおりの CSS
 * (`object-fit: cover; object-position: center`)にフォールバックすればよく、
 * それは既定値での結果と一致する。
 *
 * ### 既定値が現行表示と一致する理由
 * `zoom = 1` のとき倍率は cover そのもの。cover の定義から描画幅・高さは必ず枠以上に
 * なるので、両軸とも「はみ出す側」の式 `(枠長 - 描画長) × focus` に入る。
 * `focus = 0.5` を入れると `(枠長 - 描画長)/2` = 中央寄せで、
 * これは `object-fit: cover; object-position: center` と同じ配置。
 * (どちらの軸も等しい場合は「収まる側」の式になるが、値は同じ `(枠長 - 描画長)/2` = 0)
 *
 * @param image 写真の実寸(`img.naturalWidth/naturalHeight` か `VehiclePhoto.width/height`)
 * @param frame 表示枠。**比だけが使われる**ので `{ width: 16, height: 9 }` でよい
 * @param adjust 調整値(未設定・不正なら既定値として扱う)
 */
export function photoLayout(
  image: MaybeSize,
  frame: MaybeSize,
  adjust?: Partial<PhotoAdjust> | null,
): PhotoLayout | null {
  const img = toSize(image)
  const frm = toSize(frame)
  if (!img || !frm) return null

  const value = normalizePhotoAdjust(adjust)
  const scale = coverScale(img, frm) * value.zoom
  const drawnWidth = img.width * scale
  const drawnHeight = img.height * scale

  const x = placeAxis(frm.width, drawnWidth, value.focusX)
  const y = placeAxis(frm.height, drawnHeight, value.focusY)

  return {
    widthRatio: drawnWidth / frm.width,
    heightRatio: drawnHeight / frm.height,
    leftRatio: x.offset / frm.width,
    topRatio: y.offset / frm.height,
    zoom: value.zoom,
    containZoom: containZoom(img, frm),
    hasGapX: x.gap,
    hasGapY: y.gap,
  }
}

/** `<img>` に当てる CSS 値(パーセント文字列) */
export interface PhotoBoxStyle {
  width: string
  height: string
  left: string
  top: string
}

/**
 * CSS のパーセント値の小数桁数。
 * 4桁で 400px 幅の枠に対する誤差は 0.0004px = 表示に影響しない。
 */
const CSS_PERCENT_PRECISION = 4

/** 比 → パーセント文字列(末尾の余分な 0 は落とす) */
function toPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(CSS_PERCENT_PRECISION).replace(/\.?0+$/, '')}%`
}

/**
 * 描画ボックスを CSS の値に変換する。
 *
 * 枠は `position: relative; overflow: hidden`、`<img>` は `position: absolute` にして
 * この4値を当てる。**このボックスは常に写真と同じ縦横比**なので、`<img>` 側は
 * `object-fit: fill`(切り抜かない)にすること — `cover` のままだと二重に切り抜かれる。
 */
export function photoBoxStyle(layout: PhotoLayout | null): PhotoBoxStyle | null {
  if (!layout) return null
  return {
    width: toPercent(layout.widthRatio),
    height: toPercent(layout.heightRatio),
    left: toPercent(layout.leftRatio),
    top: toPercent(layout.topRatio),
  }
}

/**
 * `photoLayout()` + `photoBoxStyle()`。UI はふつうこれだけ呼べばよい。
 * null が返ったら従来の cover 表示のままにする(= 調整なしと同じ見え方)。
 */
export function photoFrameStyle(
  image: MaybeSize,
  frame: MaybeSize,
  adjust?: Partial<PhotoAdjust> | null,
): PhotoBoxStyle | null {
  return photoBoxStyle(photoLayout(image, frame, adjust))
}
