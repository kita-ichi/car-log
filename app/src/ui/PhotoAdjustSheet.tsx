/**
 * S-08a 写真の調整(拡大縮小・位置)【全画面シート】
 * 参照: docs/design/画面設計書.md S-08a / デザインガイド.md 5.15.6・5.15.7
 *
 * 「設定した画像の一部しか表示されない」への回答。**画像は加工せず**、
 * 倍率(zoom)と注視点(focusX/focusY)を決めるだけの画面。
 *
 * 操作の位置づけ(5.15.7):
 * - 1本指ドラッグ = 移動(必須)/ スライダー = 拡大縮小(必須。縮小できることを
 *   UI自身が語る必要があるため)/ ピンチ = 補助(これに依存する設計にしない)
 * - プリセット2つがそのままリセット手段(どちらも位置を中央に戻す)
 *
 * 確定はフォームの「保存する」。このシートの「完了」はフォームの保留状態に入れるだけ。
 */
import { useRef, useState } from 'react'
import type { PhotoAdjust, VehicleType } from '../types/models'
import {
  clampPhotoAdjust,
  normalizePhotoAdjust,
  photoLayout,
  type MaybeSize,
  type PhotoLayout,
} from '../logic/photoAdjust'
import {
  FRAME_CENTER,
  HERO_FRAME,
  ZOOM_STEP,
  canLabelBothNotches,
  fillFrame,
  fitWholePhoto,
  nudgeFocus,
  panFocus,
  pinchZoom,
  snapZoom,
  stepZoom,
  zoomAround,
  zoomLabel,
  zoomRange,
  type AnchorPoint,
} from '../logic/photoEditor'
import { ConfirmDialog } from './components'
import { CloseIcon, ZoomInIcon, ZoomOutIcon } from './icons'
import { PhotoFill, VehiclePhotoThumb, firstUsableSize, usePhotoLoadState } from './photo'

/** 矢印キー1回ぶんの移動量(Shift併用で10%) */
const KEY_STEP = 0.01
const KEY_STEP_LARGE = 0.1

/** ドラッグ/ピンチの進行状態。React の再描画を挟まずに読み書きするので ref で持つ */
type Gesture =
  | {
      kind: 'pan'
      pointerId: number
      startX: number
      startY: number
      /** 操作開始時の調整値(途中で基準がズレないよう固定する) */
      start: PhotoAdjust
      layout: PhotoLayout | null
      frame: { width: number; height: number }
    }
  | {
      kind: 'pinch'
      pointerIds: [number, number]
      startDistance: number
      start: PhotoAdjust
      anchor: AnchorPoint
    }

const distanceOf = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
  Math.hypot(a.x - b.x, a.y - b.y)

export function PhotoAdjustSheet({
  url,
  size,
  vehicleType,
  adjust,
  onDone,
  onCancel,
}: {
  /** プレビュー中の写真(ObjectURL) */
  url: string
  /** 写真の実寸。無ければ読み込み時の実測で補う */
  size: MaybeSize
  vehicleType: VehicleType
  /** 開いた時点の調整値 */
  adjust: PhotoAdjust
  /** 「完了」— 調整値をフォームの保留状態へ */
  onDone: (next: PhotoAdjust) => void
  /** 「✕」— 破棄して閉じる */
  onCancel: () => void
}) {
  const initial = normalizePhotoAdjust(adjust)
  const [value, setValue] = useState<PhotoAdjust>(initial)
  const [dragging, setDragging] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const frameRef = useRef<HTMLDivElement>(null)
  const gestureRef = useRef<Gesture | null>(null)
  const pointersRef = useRef(new Map<number, { x: number; y: number }>())
  /** ジェスチャ開始時に「今の値」を読むための鏡(イベントハンドラの陳腐化を避ける) */
  const valueRef = useRef(value)
  valueRef.current = value

  // 実寸: 保存済みの値を優先し、無ければ読み込み時の実測で補う
  const { naturalSize, imgProps } = usePhotoLoadState(url)
  const photoSize = firstUsableSize(size, naturalSize)

  const range = zoomRange(photoSize, HERO_FRAME)
  const dirty =
    value.zoom !== initial.zoom ||
    value.focusX !== initial.focusX ||
    value.focusY !== initial.focusY

  /** 枠に対する比率(0〜1)へ変換する。ドラッグ・ピンチのアンカー計算用 */
  const toAnchor = (clientX: number, clientY: number, rect: DOMRect): AnchorPoint => ({
    x: rect.width > 0 ? (clientX - rect.left) / rect.width : 0.5,
    y: rect.height > 0 ? (clientY - rect.top) / rect.height : 0.5,
  })

  /** 1本指ドラッグを(再)開始する。ピンチから指が1本減ったときもここに戻る */
  const startPan = (pointerId: number, point: { x: number; y: number }) => {
    const rect = frameRef.current?.getBoundingClientRect()
    if (!rect) return
    const start = valueRef.current
    gestureRef.current = {
      kind: 'pan',
      pointerId,
      startX: point.x,
      startY: point.y,
      start,
      layout: photoLayout(photoSize, HERO_FRAME, start),
      frame: { width: rect.width, height: rect.height },
    }
  }

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const point = { x: e.clientX, y: e.clientY }
    pointersRef.current.set(e.pointerId, point)
    // 枠の外に指が出ても追従させる。捕捉できない環境でもドラッグ自体は続けられるよう
    // 失敗しても止めない(ここで例外を投げると以降の操作が一切効かなくなる)
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* 捕捉できない場合はそのまま続行 */
    }
    setDragging(true)

    const ids = [...pointersRef.current.keys()]
    if (ids.length >= 2) {
      // ピンチ(補助操作): 2本指の中点を保持したまま倍率を変える
      const [a, b] = [ids[ids.length - 2], ids[ids.length - 1]]
      const pa = pointersRef.current.get(a)!
      const pb = pointersRef.current.get(b)!
      const rect = frameRef.current?.getBoundingClientRect()
      if (!rect) return
      gestureRef.current = {
        kind: 'pinch',
        pointerIds: [a, b],
        startDistance: distanceOf(pa, pb),
        start: valueRef.current,
        anchor: toAnchor((pa.x + pb.x) / 2, (pa.y + pb.y) / 2, rect),
      }
      return
    }
    startPan(e.pointerId, point)
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(e.pointerId)) return
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const gesture = gestureRef.current
    if (!gesture) return

    if (gesture.kind === 'pinch') {
      const pa = pointersRef.current.get(gesture.pointerIds[0])
      const pb = pointersRef.current.get(gesture.pointerIds[1])
      if (!pa || !pb) return
      setValue(
        pinchZoom(
          gesture.start,
          photoSize,
          HERO_FRAME,
          gesture.startDistance,
          distanceOf(pa, pb),
          gesture.anchor,
          range,
        ),
      )
      return
    }

    if (gesture.pointerId !== e.pointerId) return
    setValue(
      panFocus(
        gesture.start,
        gesture.layout,
        gesture.frame,
        e.clientX - gesture.startX,
        e.clientY - gesture.startY,
      ),
    )
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(e.pointerId)
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId)
      }
    } catch {
      /* 既に解放済み */
    }
    const remaining = [...pointersRef.current.entries()]
    if (remaining.length === 1) {
      // ピンチから指が1本減った → 残った指でドラッグを続けられるよう基準を取り直す
      startPan(remaining[0][0], remaining[0][1])
      return
    }
    if (remaining.length === 0) {
      gestureRef.current = null
      setDragging(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? KEY_STEP_LARGE : KEY_STEP
    const move: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }
    const delta = move[e.key]
    if (!delta) return
    e.preventDefault()
    setValue((current) => nudgeFocus(current, delta[0], delta[1]))
  }

  /** 倍率の変更はすべて枠の中心を保持して行う(中央にあるものが中央に残る) */
  const applyZoom = (next: number) =>
    setValue((current) => zoomAround(current, photoSize, HERO_FRAME, next, FRAME_CENTER))

  const requestClose = () => (dirty ? setConfirmDiscard(true) : onCancel())

  /** スライダー上の位置(つまみ28pxぶん内側に寄せる) */
  const notchLeft = (zoom: number): string => {
    const ratio = range.max > range.min ? (zoom - range.min) / (range.max - range.min) : 0
    return `calc(14px + (100% - 28px) * ${ratio})`
  }

  return (
    <div className="overlay full">
      <div className="pa-sheet" role="dialog" aria-modal="true" aria-label="写真の調整">
        <header className="appbar">
          <button className="iconbtn" onClick={requestClose} aria-label="キャンセル">
            <CloseIcon />
          </button>
          <span className="title">写真の調整</span>
        </header>

        <div className="pa-body">
          {/* 編集面: スクリムなしの素の写真(暗幕越しでは位置合わせができないため) */}
          <div
            ref={frameRef}
            className={`pa-frame${dragging ? ' dragging' : ''}`}
            tabIndex={0}
            role="group"
            aria-label="写真の位置(矢印キーで移動できます)"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onKeyDown={handleKeyDown}
          >
            <PhotoFill
              url={url}
              size={photoSize}
              frame={HERO_FRAME}
              adjust={value}
              imgProps={imgProps}
            />
            <span className="pa-grid" aria-hidden="true">
              <span className="v" style={{ left: '33.3333%' }} />
              <span className="v" style={{ left: '66.6667%' }} />
              <span className="h" style={{ top: '33.3333%' }} />
              <span className="h" style={{ top: '66.6667%' }} />
            </span>
            {/* 文字が乗る位置のゴースト表示(実際の位置・サイズ)。装飾のため aria-hidden */}
            <span className="pa-ghost" aria-hidden="true">
              <span className="lbl">直近の燃費</span>
              <span className="big num">
                19.2<small>km/L</small>
              </span>
            </span>
          </div>

          <p className="pa-note">ドラッグで位置・スライダーで大きさを調整できます</p>
          <p className="pa-note dim">ホームでは全体に暗幕がかかります(数値を読みやすくするため)</p>

          {/* 現在値はトラックの上に置く(横に並べるとトラックが狭まり、
              ノッチのラベルが重なって読めなくなるため) */}
          <div className="pa-zoomhead">
            <span className="l">大きさ</span>
            <span className="pa-val num" aria-hidden="true">
              {zoomLabel(value.zoom, range.min)}
            </span>
          </div>
          <div className="pa-zoom">
            <button
              className="pa-step"
              onClick={() => applyZoom(stepZoom(value.zoom, -ZOOM_STEP, range.min, range.max))}
              aria-label="写真を小さくする"
              disabled={value.zoom <= range.min}
            >
              <ZoomOutIcon size={22} />
            </button>
            <div className="pa-track">
              <input
                type="range"
                min={range.min}
                max={range.max}
                step={0.01}
                value={value.zoom}
                onChange={(e) => applyZoom(snapZoom(Number(e.target.value), range.min, range.max))}
                aria-label="写真の大きさ"
                aria-valuetext={zoomLabel(value.zoom, range.min)}
              />
              {/* ノッチ: 全体(下限)と枠いっぱい(1.0)。確実に止められることを見せる */}
              <span className="pa-notch" style={{ left: notchLeft(range.min) }} aria-hidden="true" />
              <span className="pa-notch" style={{ left: notchLeft(1) }} aria-hidden="true" />
              {/* ラベルは重ならないときだけ2つ出す(横4:3のように下限が1.0に近い写真では
                  「枠いっぱい」だけ。左端=全体はつまみを寄せれば現在値表示で分かる) */}
              {canLabelBothNotches(range) && (
                /* 下限のノッチはトラックの左端なので、ラベルも左寄せにする */
                <span className="pa-tick start" aria-hidden="true">
                  全体
                </span>
              )}
              <span className="pa-tick" style={{ left: notchLeft(1) }} aria-hidden="true">
                枠いっぱい
              </span>
            </div>
            <button
              className="pa-step"
              onClick={() => applyZoom(stepZoom(value.zoom, ZOOM_STEP, range.min, range.max))}
              aria-label="写真を大きくする"
              disabled={value.zoom >= range.max}
            >
              <ZoomInIcon size={22} />
            </button>
          </div>

          {/* プリセット(= リセット手段)。どちらも位置を中央に戻す */}
          <div className="pa-presets">
            <button className="chip lg" onClick={() => setValue(fitWholePhoto(photoSize, HERO_FRAME))}>
              全体を表示
            </button>
            <button className="chip lg" onClick={() => setValue(fillFrame())}>
              枠いっぱいに戻す
            </button>
          </div>

          {/* 44pxサムネのライブプレビュー(拡大しすぎに気づける唯一の場所) */}
          <div className="pa-thumbrow">
            <VehiclePhotoThumb
              type={vehicleType}
              hasPhoto
              url={url}
              adjust={value}
              size={photoSize}
              loading="eager"
            />
            <span className="cap">一覧・切り替えでの見え方</span>
          </div>
        </div>

        <footer className="pa-foot">
          <button className="btn primary" onClick={() => onDone(clampPhotoAdjust(value))}>
            完了
          </button>
          <p className="cap">調整はフォームの「保存する」で確定します</p>
        </footer>
      </div>

      <ConfirmDialog
        open={confirmDiscard}
        title="調整を破棄しますか?"
        body="この画面で変更した大きさ・位置は元に戻ります。"
        confirmLabel="破棄"
        onConfirm={onCancel}
        onCancel={() => setConfirmDiscard(false)}
      />
    </div>
  )
}
