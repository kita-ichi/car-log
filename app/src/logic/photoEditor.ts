/**
 * 写真調整シート(S-08a)の操作ロジック(純粋関数)
 * 参照: docs/design/デザインガイド.md 5.15.6 / 5.15.7、docs/design/画面設計書.md S-08a
 *
 * 値の定義と描画規則そのものは `logic/photoAdjust.ts` にある。
 * こちらは **UI の操作(ドラッグ・スライダー・ピンチ・プリセット)を
 * 調整値の変化に翻訳する層**で、DOM・React には依存しない(テスト可能にするため)。
 *
 * UI 側に残す仕事は「ピクセルを測る」「イベントを受ける」だけにする。
 */
import type { PhotoAdjust } from '../types/models'
import {
  MAX_PHOTO_ZOOM,
  normalizePhotoAdjust,
  photoLayout,
  type MaybeSize,
  type PhotoLayout,
  type Size,
} from './photoAdjust'

// ---------------------------------------------------------------------------
// 枠・定数
// ---------------------------------------------------------------------------

/** ヒーロー・フォームプレビュー・編集枠の比(デザインガイド `--ph-hero-ar`) */
export const HERO_FRAME: Size = { width: 16, height: 9 }

/** 44pxサムネイルの比(`--ph-thumb-ar`) */
export const THUMB_FRAME: Size = { width: 1, height: 1 }

/** サムネイルに課す倍率の下限(44px枠に余白を作らない。5.15.6「2つの枠への適用」) */
export const THUMB_MIN_ZOOM = 1

/**
 * 1.0(枠いっぱい)へスナップする幅(5.15.7)。
 * 「余白ゼロぴったり」に戻せないと不満になるため、スライダー操作では必ず 1.0 を踏める。
 */
export const ZOOM_SNAP = 0.02

/** −/+ ボタン1回ぶんの変化量(5.15.7: ±5%) */
export const ZOOM_STEP = 0.05

/**
 * 発見性のヒントチップを出すしきい値(5.15.4)。
 * 既定(枠いっぱい)で写真の 70% 未満しか映らないときだけ出す
 * = 横4:3(0.75)では出さず、縦写真(0.42)やパノラマで出る。
 */
export const HINT_ZOOM_THRESHOLD = 0.7

/** 「全体」表示の判定・スナップ判定に使う許容誤差 */
const EPSILON = 1e-6

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

// ---------------------------------------------------------------------------
// スライダーの範囲・値
// ---------------------------------------------------------------------------

export interface ZoomRange {
  /** 下限 = 写真全体が枠に収まる倍率(写真ごとに変わる) */
  min: number
  /** 上限 = `MAX_PHOTO_ZOOM`(3.0) */
  max: number
}

/**
 * スライダーの範囲。**下限は定数ではなくこの枠の `containZoom()`** にする
 * (それ以上縮めても余白が増えるだけで、見える範囲は変わらないため)。
 *
 * 写真の実寸が不明なときは縮小しても描画に反映できない(`photoLayout()` が
 * null を返し cover 表示にフォールバックする)ので、下限を 1 にして
 * 「縮小できるのにUIだけ動く」状態を作らない。
 */
export function zoomRange(image: MaybeSize, frame: MaybeSize): ZoomRange {
  const layout = photoLayout(image, frame)
  return { min: layout ? Math.min(layout.containZoom, 1) : 1, max: MAX_PHOTO_ZOOM }
}

/**
 * スライダー・±ボタンの生値を仕上げる: 範囲クランプ + **1.0 へのスナップ**。
 * 下限が 1.0 に近い写真(ほぼ枠と同じ比)では下限を潰さないよう、
 * スナップより範囲のクランプを後に効かせる。
 */
export function snapZoom(raw: number, min: number, max: number = MAX_PHOTO_ZOOM): number {
  if (!Number.isFinite(raw)) return min
  // 誤差込みで比較する(0.98 + 0.04 が 1.0200000000000002 になってスナップを外さない)
  const snapped = Math.abs(raw - 1) <= ZOOM_SNAP + EPSILON ? 1 : raw
  return clamp(snapped, min, max)
}

/**
 * −/+ ボタン(±5%)。境界では下限・上限にちょうど止まる。
 *
 * **1.0 をまたぐ操作は 1.0 で一度止める**(0.98 → +5% で 1.03 に飛ぶと
 * 「枠いっぱい」をボタンだけで踏めなくなるため。5.15.7「確実に止められる」)。
 */
export function stepZoom(
  current: number,
  delta: number,
  min: number,
  max: number = MAX_PHOTO_ZOOM,
): number {
  const next = current + delta
  if ((current - 1) * (next - 1) < 0) return clamp(1, min, max)
  return snapZoom(next, min, max)
}

/**
 * 現在値の表示(5.15.7)。`aria-valuetext` にもそのまま使う。
 * 下限に達したときだけ「全体」、それ以外は枠いっぱい=100% とした%表示。
 */
export function zoomLabel(zoom: number, min: number): string {
  if (zoom <= min + EPSILON) return '全体'
  return `${Math.round(zoom * 100)}%`
}

/**
 * ノッチのラベル(「全体」「枠いっぱい」)を2つとも置けるだけ離れているか。
 *
 * 下限が 1.0 に近い写真(横4:3 なら 0.75)では2つのノッチがトラック上で
 * 11% ほどしか離れず、375px幅ではラベルが重なって読めなくなる。
 * その場合は「枠いっぱい」だけを出す — 下限側はスライダーの左端そのもので、
 * つまみを端に寄せれば現在値の表示が「全体」になるため意味は失われない。
 *
 * しきい値 0.19 の根拠(375px幅): トラックの実効幅は 219px、
 * 左端に置く「全体」が 22px + 余白6px なので、「枠いっぱい」の中心(ラベル幅55pxの半分)は
 * 左端から 28 + 27.5 = 55.5px 以上、つまり `(55.5 − 14) ÷ 219 ≒ 0.19` 以上必要になる。
 */
export function canLabelBothNotches(range: ZoomRange): boolean {
  if (range.max <= range.min) return false
  return (1 - range.min) / (range.max - range.min) >= 0.19
}

// ---------------------------------------------------------------------------
// プリセット(= リセット手段。5.15.7)
// ---------------------------------------------------------------------------

/** 「全体を表示」: 写真全体が収まる倍率 + 位置は中央 */
export function fitWholePhoto(image: MaybeSize, frame: MaybeSize): PhotoAdjust {
  return { zoom: zoomRange(image, frame).min, focusX: 0.5, focusY: 0.5 }
}

/** 「枠いっぱいに戻す」= 既定値(cover + center)。実質のリセット */
export function fillFrame(): PhotoAdjust {
  return { zoom: 1, focusX: 0.5, focusY: 0.5 }
}

/**
 * 発見性のヒント(5.15.4)を出すか。
 * **既定値のとき写真の 70% 未満しか映らない場合のみ** true。
 * ユーザーの調整状態には依存しない(「この写真は既定では収まらない」という事実の提示)。
 */
export function shouldHintPhotoAdjust(image: MaybeSize, frame: MaybeSize): boolean {
  const layout = photoLayout(image, frame)
  return layout !== null && layout.containZoom < HINT_ZOOM_THRESHOLD
}

// ---------------------------------------------------------------------------
// ドラッグ(位置移動)
// ---------------------------------------------------------------------------

/** 枠の実寸(px)。ドラッグ量を注視点に変換するために UI 側で測って渡す */
export interface FrameSize {
  width: number
  height: number
}

/**
 * ドラッグ量(px)を新しい注視点に変換する(5.15.6)。
 *
 * `Δfocus = −Δpx ÷ (描画長 − 枠長)`。
 * - **はみ出している軸だけ動く**(収まっている軸は中央固定なので反応させない)
 * - 端に達したら 0〜1 のクランプで自然に止まる(引っぱりすぎても余白は出ない)
 *
 * @param adjust ドラッグ開始時点の調整値(途中で基準がズレないよう開始値を渡す)
 * @param layout 同じ調整値での描画ボックス(`photoLayout()`)。null なら移動しない
 * @param frame 編集枠の実寸(px)
 * @param dx ドラッグ開始からの移動量(px。右が正)
 * @param dy 同(下が正)
 */
export function panFocus(
  adjust: Partial<PhotoAdjust> | null | undefined,
  layout: PhotoLayout | null,
  frame: FrameSize,
  dx: number,
  dy: number,
): PhotoAdjust {
  const value = normalizePhotoAdjust(adjust)
  if (!layout) return value

  // はみ出し量(px)。0以下ならその軸は動かせない
  const overflowX = (layout.widthRatio - 1) * frame.width
  const overflowY = (layout.heightRatio - 1) * frame.height

  return {
    zoom: value.zoom,
    focusX: overflowX > 0 ? clamp(value.focusX - dx / overflowX, 0, 1) : value.focusX,
    focusY: overflowY > 0 ? clamp(value.focusY - dy / overflowY, 0, 1) : value.focusY,
  }
}

/**
 * 矢印キーでの移動(ドラッグの代替。5.15.7 アクセシビリティ)。
 * 注視点を直接 ±step 動かす(px ではなく写真上の割合で動かすので枠の実寸が要らない)。
 */
export function nudgeFocus(
  adjust: Partial<PhotoAdjust> | null | undefined,
  dxRatio: number,
  dyRatio: number,
): PhotoAdjust {
  const value = normalizePhotoAdjust(adjust)
  return {
    zoom: value.zoom,
    focusX: clamp(value.focusX + dxRatio, 0, 1),
    focusY: clamp(value.focusY + dyRatio, 0, 1),
  }
}

// ---------------------------------------------------------------------------
// 拡大縮小(注目点を保つ)
// ---------------------------------------------------------------------------

/** 枠に対する比率で表した点(0,0 = 枠の左上 / 1,1 = 右下) */
export interface AnchorPoint {
  x: number
  y: number
}

/** 枠の中心(スライダー・±ボタンはここを固定して拡大縮小する) */
export const FRAME_CENTER: AnchorPoint = { x: 0.5, y: 0.5 }

/**
 * 1軸ぶん: アンカー(枠に対する比率)の下にある写真上の点を保ったまま倍率を変える。
 *
 * 描画ボックスは枠を1とした比で表されるので、
 * - アンカー下の写真上の位置: `u = (anchor − left) ÷ D`
 * - 倍率変更後の描画長: `D' = D × (zoom' ÷ zoom)`
 * - 保ちたい配置: `left' = anchor − u × D'`
 * - 注視点に戻す: `focus' = left' ÷ (1 − D')`(`left = (1 − D) × focus` の逆算)
 *
 * `D' ≤ 1`(縮小して収まった)ときは注視点に意味が無く中央固定になるため、
 * **元の注視点をそのまま残す**(拡大に戻したときに元の構図へ復帰できる)。
 * 判定に誤差を持たせているのは、`D' ≒ 1` のとき `1 − D'` がほぼ 0 になり、
 * 割り算が発散して注視点が端に飛ぶため(ちょうど枠に収まる倍率で必ず起きる)。
 */
function zoomAxis(
  anchor: number,
  offsetRatio: number,
  drawnRatio: number,
  focus: number,
  scale: number,
): number {
  const nextDrawn = drawnRatio * scale
  if (nextDrawn <= 1 + EPSILON) return focus
  const u = drawnRatio > 0 ? (anchor - offsetRatio) / drawnRatio : 0.5
  const nextOffset = anchor - u * nextDrawn
  return clamp(nextOffset / (1 - nextDrawn), 0, 1)
}

/**
 * 枠上の一点を固定したまま倍率を変える(スライダー・±ボタン・ピンチ共通)。
 *
 * - スライダー・±ボタン: `FRAME_CENTER`(枠の中心にあるものが中心に残る)
 * - ピンチ: 2本指の中点(デザインガイド 5.15.7「2本指の中点を保持してズームする」)
 *
 * 実寸が不明で描画ボックスを計算できない場合は倍率だけ変える。
 */
export function zoomAround(
  adjust: Partial<PhotoAdjust> | null | undefined,
  image: MaybeSize,
  frame: MaybeSize,
  nextZoom: number,
  anchor: AnchorPoint = FRAME_CENTER,
): PhotoAdjust {
  const value = normalizePhotoAdjust(adjust)
  const layout = photoLayout(image, frame, value)
  if (!layout || value.zoom <= 0) return { ...value, zoom: nextZoom }

  const scale = nextZoom / value.zoom
  return {
    zoom: nextZoom,
    focusX: zoomAxis(anchor.x, layout.leftRatio, layout.widthRatio, value.focusX, scale),
    focusY: zoomAxis(anchor.y, layout.topRatio, layout.heightRatio, value.focusY, scale),
  }
}

/**
 * ピンチの拡大縮小(補助操作)。2本指の距離の比を倍率に掛け、中点を固定する。
 *
 * @param startAdjust ピンチ開始時の調整値(指を動かしている間の基準)
 * @param startDistance 開始時の2点間距離(px)
 * @param distance 現在の2点間距離(px)
 * @param anchor 2本指の中点(枠に対する比率)
 */
export function pinchZoom(
  startAdjust: Partial<PhotoAdjust> | null | undefined,
  image: MaybeSize,
  frame: MaybeSize,
  startDistance: number,
  distance: number,
  anchor: AnchorPoint,
  range: ZoomRange,
): PhotoAdjust {
  const value = normalizePhotoAdjust(startAdjust)
  if (startDistance <= 0 || distance <= 0) return value
  const next = snapZoom((value.zoom * distance) / startDistance, range.min, range.max)
  return zoomAround(value, image, frame, next, anchor)
}
