/**
 * 愛車の写真(F-22 / F-22b)の共通UI部品(デザインガイド 5.15 / 画面設計書 §0.4)
 * - 写真の読み込み(ObjectURL の生成と解放)を行うフック
 * - 調整値(倍率・注視点)を当てて枠に敷く `PhotoFill`
 * - 44pxサムネイル(S-08 一覧 / S-11 切り替えシート)
 * - 写真ピッカー(S-08 車両編集フォーム)
 *
 * 方針:
 * - 写真の**有無**は `vehicle.photoUpdatedAt` で判定する(DBを触らない)。
 *   画像を実際に表示するときだけ `getPhoto` / `getPhotos` を呼ぶ
 * - 一覧では行ごとに `getPhoto` を呼ばず `getPhotos(ids)` で一括取得する
 * - 作った ObjectURL は必ず解放する(useEffect のクリーンアップ)
 * - 読み込み失敗は**無言でフォールバック**(タイプアイコン / 無地ネイビー)
 * - 調整値は ObjectURL の依存配列に**入れない**(位置を動かすたびに画像を読み直さない)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PhotoAdjust, Vehicle, VehiclePhoto, VehicleType } from '../types/models'
import { vehicleRepository, type PhotoAssignment } from '../db/repositories'
import { ImageError, formatByteSize, formatCompressionNote } from '../logic/image'
import {
  clampPhotoAdjust,
  isDefaultPhotoAdjust,
  normalizePhotoAdjust,
  photoBoxStyle,
  photoLayout,
  withMinZoom,
  type MaybeSize,
  type Size,
} from '../logic/photoAdjust'
import {
  HERO_FRAME,
  THUMB_FRAME,
  THUMB_MIN_ZOOM,
  shouldHintPhotoAdjust,
} from '../logic/photoEditor'
import {
  createPhotoObjectUrl,
  processVehiclePhoto,
  revokePhotoObjectUrl,
  type ProcessedImage,
} from './imageProcessing'
import { ExpandIcon, PhotoIcon, VehicleIcon } from './icons'

/* ============ 読み込みフック ============ */

/**
 * 1台分の写真を読み込む(S-01 ホームのヒーロー / S-08 フォームのプレビュー)。
 * 写真なし・読み込み前は `{ url: null }`。差し替え(`photoUpdatedAt` の変化)で作り直す。
 */
export function useVehiclePhoto(vehicle: Vehicle | null | undefined): {
  url: string | null
  photo: VehiclePhoto | null
} {
  const [state, setState] = useState<{ url: string | null; photo: VehiclePhoto | null }>({
    url: null,
    photo: null,
  })
  const id = vehicle?.id ?? null
  const updatedAt = vehicle?.photoUpdatedAt ?? null

  useEffect(() => {
    if (id === null || updatedAt === null) {
      setState((prev) => (prev.url === null && prev.photo === null ? prev : { url: null, photo: null }))
      return
    }
    let alive = true
    let created: string | null = null
    void vehicleRepository
      .getPhoto(id)
      .then((photo) => {
        if (!photo) return
        created = createPhotoObjectUrl(photo)
        if (alive) setState({ url: created, photo })
        else revokePhotoObjectUrl(created) // アンマウント後に届いた場合
      })
      .catch((err) => console.error('車両写真の読込に失敗:', err))
    return () => {
      alive = false
      revokePhotoObjectUrl(created)
    }
  }, [id, updatedAt])

  return state
}

/**
 * 複数車両の写真をまとめて読み込む(S-08 一覧 / S-11 切り替えシート)。
 * 戻り値は `Map<vehicleId, ObjectURL>`(写真なしの車両はキーごと入らない)。
 *
 * @param enabled false の間は読み込まない(シートが閉じている間に URL を抱えないため)
 */
export function useVehiclePhotoUrls(
  vehicles: readonly Vehicle[],
  enabled = true,
): Map<string, string> {
  const [urls, setUrls] = useState<Map<string, string>>(new Map())

  // 写真を持つ車両だけを対象にする(= getPhotos に渡すID)。
  // 更新時刻もキーに含めることで、写真の差し替え時に ObjectURL を作り直す
  const targets = useMemo(
    () => vehicles.filter((v) => v.photoUpdatedAt !== undefined),
    [vehicles],
  )
  const idKey = targets.map((v) => v.id).join(',')
  const stampKey = targets.map((v) => v.photoUpdatedAt).join(',')

  useEffect(() => {
    const ids = enabled && idKey !== '' ? idKey.split(',') : []
    if (ids.length === 0) {
      setUrls((prev) => (prev.size === 0 ? prev : new Map()))
      return
    }
    let alive = true
    const created: string[] = []
    void vehicleRepository
      .getPhotos(ids)
      .then((photos) => {
        const map = new Map<string, string>()
        for (const [vehicleId, photo] of photos) {
          const url = createPhotoObjectUrl(photo)
          created.push(url)
          map.set(vehicleId, url)
        }
        if (alive) setUrls(map)
        else created.forEach(revokePhotoObjectUrl)
      })
      .catch((err) => console.error('車両写真の読込に失敗:', err))
    return () => {
      alive = false
      created.forEach(revokePhotoObjectUrl)
    }
  }, [idKey, stampKey, enabled])

  return urls
}

/** `<img>` に渡す読み込みハンドラ(そのまま展開して使う) */
export interface PhotoImgProps {
  onLoad: (event: React.SyntheticEvent<HTMLImageElement>) => void
  onError: () => void
  decoding: 'async'
}

/**
 * `<img>` の読み込み状態(5.15.5)。
 * - 到着したら `shown` が true になる(呼び出し側でフェードイン用のクラスを付ける)
 * - 失敗したら `failed`。**エラー表示はせず**タイプアイコン/無地ネイビーに戻す
 * - 到着時に**実寸**を控える。調整値(5.15.6)の描画に必要で、`VehiclePhoto.width/height`
 *   を持たない古いレコードでもこれで補える
 */
export function usePhotoLoadState(url: string | null | undefined): {
  shown: boolean
  failed: boolean
  /** 読み込めた画像の実寸(未ロード・失敗・取得不可なら null) */
  naturalSize: Size | null
  imgProps: PhotoImgProps
} {
  // 結果は URL とセットで持つ。写真を差し替えた直後に前の結果を引きずらない
  const [result, setResult] = useState<{
    url: string
    status: 'loaded' | 'failed'
    size: Size | null
  } | null>(null)
  const current = url && result?.url === url ? result : null

  return {
    shown: current?.status === 'loaded',
    failed: current?.status === 'failed',
    naturalSize: current?.size ?? null,
    imgProps: {
      onLoad: (event) => {
        const img = event.currentTarget
        if (!url) return
        const size = img.naturalWidth > 0 && img.naturalHeight > 0
          ? { width: img.naturalWidth, height: img.naturalHeight }
          : null
        setResult({ url, status: 'loaded', size })
      },
      onError: () => url && setResult({ url, status: 'failed', size: null }),
      decoding: 'async',
    },
  }
}

/* ============ 調整値を当てた描画(5.15.6) ============ */

/** 幅・高さが揃っている最初の寸法を返す(保存済みの実寸 → 実測 の順に使う) */
export function firstUsableSize(...sizes: MaybeSize[]): MaybeSize {
  return (
    sizes.find(
      (s): s is Size =>
        !!s &&
        typeof s.width === 'number' &&
        s.width > 0 &&
        typeof s.height === 'number' &&
        s.height > 0,
    ) ?? null
  )
}

/**
 * 枠に写真を敷く(調整値を反映)。
 *
 * 枠側は `position: relative; overflow: hidden` + 比の固定(`aspect-ratio`)にしておく。
 * 実寸が分からない場合は**従来どおりの cover 表示**にフォールバックする
 * (= 調整の既定値と同じ見え方なので、既存の写真の見え方は変わらない)。
 *
 * 縮小して余白が出たときだけ、写真の外周に内枠1px(`--ph-pad-edge`)を重ねる。
 * `<img>` 自身の inset シャドウは画像本体に隠れるため、同じ位置の要素で描く。
 */
export function PhotoFill({
  url,
  alt = '',
  size,
  frame,
  adjust,
  minZoom,
  imgClassName,
  loading,
  imgProps,
}: {
  url: string
  /** 装飾なら '' のまま(5.15.5: 一覧・ヒーローは alt="") */
  alt?: string
  /** 写真の実寸。null/欠損なら cover にフォールバック */
  size: MaybeSize
  /** 枠の比(`HERO_FRAME` / `THUMB_FRAME`)。実ピクセルの測定は不要 */
  frame: Size
  adjust?: Partial<PhotoAdjust> | null
  /** 倍率の下限(44pxサムネは 1 = 余白を作らない) */
  minZoom?: number
  imgClassName?: string
  loading?: 'lazy' | 'eager'
  imgProps?: PhotoImgProps
}) {
  const value = minZoom === undefined ? adjust : withMinZoom(adjust, minZoom)
  const layout = photoLayout(size, frame, value)
  const style = photoBoxStyle(layout) ?? undefined
  const hasGap = layout !== null && (layout.hasGapX || layout.hasGapY)

  return (
    <>
      <img
        src={url}
        alt={alt}
        loading={loading}
        style={style}
        className={[imgClassName, style ? 'ph-box' : null].filter(Boolean).join(' ') || undefined}
        {...imgProps}
      />
      {hasGap && <span className="ph-edge" style={style} aria-hidden="true" />}
    </>
  )
}

/* ============ サムネイル(5.15.2) ============ */

/**
 * 一覧・シートの行頭サムネイル(44px固定)。
 *
 * | 状態 | 表示 |
 * |---|---|
 * | 写真あり | 写真 + 右下に車両タイプバッジ(18px) |
 * | 写真なし・読み込み失敗 | 写真スロットの中央にタイプアイコン24px |
 * | 読み込み中 | 写真スロットのみ(無地)。到着したらフェードイン |
 *
 * 調整値(5.15.6)は**注視点はそのまま・倍率は `max(1, zoom)`** で反映する。
 * 「どこを写したいか」の意図は共有しつつ、識別が目的の44px枠に余白は作らない。
 *
 * 装飾のため `aria-hidden`(車両名テキスト・行の aria-label が情報を担う)。
 */
export function VehiclePhotoThumb({
  type,
  hasPhoto,
  url,
  adjust,
  size,
  loading = 'lazy',
}: {
  type: VehicleType
  /** 写真が設定されているか(`vehicle.photoUpdatedAt !== undefined`) */
  hasPhoto: boolean
  url?: string | null
  /** 表示調整(`vehicle.photoAdjust`)。未設定なら従来どおりの中央 cover */
  adjust?: Partial<PhotoAdjust> | null
  /** 写真の実寸(`VehiclePhoto.width/height`)。無ければ読み込み時の実測で補う */
  size?: MaybeSize
  /** 一覧は lazy、シート内は eager(開いた瞬間に見える必要がある) */
  loading?: 'lazy' | 'eager'
}) {
  const { shown, failed, naturalSize, imgProps } = usePhotoLoadState(url)
  // 写真があるはずだがまだ届いていない = 無地のスロット(アイコンを出すとチラつく)
  const pending = hasPhoto && !shown && !failed

  return (
    <span className="vthumb" aria-hidden="true">
      {url && !failed && (
        /* 拡大した写真が44px枠からはみ出さないようクリップする(バッジは枠の外に出す) */
        <span className="clip">
          <PhotoFill
            url={url}
            size={firstUsableSize(size, naturalSize)}
            frame={THUMB_FRAME}
            adjust={adjust}
            minZoom={THUMB_MIN_ZOOM}
            loading={loading}
            imgClassName={`ph-fade${shown ? ' on' : ''}`}
            imgProps={imgProps}
          />
        </span>
      )}
      {shown ? (
        <span className="tbadge">
          <VehicleIcon type={type} size={12} />
        </span>
      ) : (
        !pending && <VehicleIcon type={type} size={24} />
      )}
    </span>
  )
}

/* ============ 写真ピッカー(5.15.4 / S-08 車両編集フォーム) ============ */

/** フォーム内で保留(staged)している写真の操作。「保存する」まで DB には書かない */
type StagedPhoto =
  | { kind: 'keep' } // 変更なし(既存写真をそのまま)
  | { kind: 'set'; processed: ProcessedImage; url: string } // 新しく選んだ写真
  | { kind: 'remove' } // 削除(保存時に反映)

export interface StagedVehiclePhoto {
  /** プレビューに出す画像URL。未設定・削除予定なら null */
  previewUrl: string | null
  /** プレビュー写真の実寸(調整値の描画・スライダー下限に使う)。不明なら null */
  previewSize: MaybeSize
  /** 表示中の写真に適用する調整値(保留中の変更を反映済み) */
  adjust: PhotoAdjust
  /** 調整シート(S-08a)の結果を保留する。DBへの保存はフォームの「保存する」 */
  stageAdjust: (next: PhotoAdjust) => void
  /** 既存写真の読み込み中(枠は出すが中身がまだ無い状態) */
  loadingExisting: boolean
  /** 「3.4 MB → 210 KB」/ 既存写真は保存サイズのみ */
  sizeNote: string | null
  processing: boolean
  /** 150ms を超えて処理が続いているか(ちらつき防止でそれまではスピナーを出さない) */
  showSpinner: boolean
  /** 取り込み失敗のメッセージ(ダイアログは出さず枠内に表示する) */
  error: string | null
  pickFile: (file: File) => Promise<void>
  /** 削除を予約する(確認ダイアログでOKされた後に呼ぶ) */
  removePhoto: () => void
  /** 保存時に vehicleRepository へ渡す値(undefined=変更なし / null=削除) */
  photoPatch: PhotoAssignment | undefined
  /** 保存時に渡す調整値(undefined=変更なし。写真の差し替え・削除時は既定へ戻る) */
  adjustPatch: PhotoAdjust | undefined
}

/**
 * 車両編集フォームの写真を staged(保存で確定)で扱うフック。
 * 追加・変更・削除はフォームの他項目と同じく「保存する」で確定し、キャンセルで元に戻る。
 *
 * @param target フォームの対象('new' = 新規登録 / Vehicle = 編集 / null = フォーム非表示)
 */
export function useStagedVehiclePhoto(target: 'new' | Vehicle | null): StagedVehiclePhoto {
  const vehicle = target !== null && target !== 'new' ? target : null
  const existing = useVehiclePhoto(vehicle)
  const [staged, setStaged] = useState<StagedPhoto>({ kind: 'keep' })
  /** 保留中の調整値。null = このフォームではまだ調整していない(= 変更なし) */
  const [stagedAdjust, setStagedAdjust] = useState<PhotoAdjust | null>(null)
  const [processing, setProcessing] = useState(false)
  const [showSpinner, setShowSpinner] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const stagedUrlRef = useRef<string | null>(null)

  /** 保留中の写真を差し替える(前の ObjectURL は必ず解放する) */
  const replaceStaged = useCallback((next: StagedPhoto) => {
    revokePhotoObjectUrl(stagedUrlRef.current)
    stagedUrlRef.current = next.kind === 'set' ? next.url : null
    setStaged(next)
    // 写真を差し替え・削除したら調整は引き継がない(別の構図に他人の調整が乗ると破綻する)
    setStagedAdjust(null)
  }, [])

  // フォームを開き直したら(別の車両・新規登録)選択内容を破棄する
  const formKey = target === null ? '' : target === 'new' ? 'new' : target.id
  useEffect(() => {
    replaceStaged({ kind: 'keep' })
    setError(null)
  }, [formKey, replaceStaged])

  // アンマウント時に保留中の ObjectURL を解放する
  useEffect(() => () => revokePhotoObjectUrl(stagedUrlRef.current), [])

  const pickFile = useCallback(
    async (file: File) => {
      setError(null)
      setProcessing(true)
      // 150ms 未満で終わる場合はスピナーを出さない(ちらつき防止)
      const timer = setTimeout(() => setShowSpinner(true), 150)
      try {
        const processed = await processVehiclePhoto(file)
        replaceStaged({ kind: 'set', processed, url: createPhotoObjectUrl(processed) })
      } catch (err) {
        console.error('写真の取り込みに失敗:', err)
        setError(
          err instanceof ImageError
            ? err.message
            : 'この写真は読み込めませんでした。別の写真を選んでください',
        )
      } finally {
        clearTimeout(timer)
        setProcessing(false)
        setShowSpinner(false)
      }
    },
    [replaceStaged],
  )

  const removePhoto = useCallback(() => {
    replaceStaged({ kind: 'remove' })
    setError(null)
  }, [replaceStaged])

  const previewUrl =
    staged.kind === 'set' ? staged.url : staged.kind === 'remove' ? null : existing.url

  const previewSize =
    staged.kind === 'set'
      ? { width: staged.processed.width, height: staged.processed.height }
      : staged.kind === 'keep'
        ? existing.photo
        : null

  const sizeNote =
    staged.kind === 'set'
      ? formatCompressionNote(staged.processed.sourceByteSize, staged.processed.byteSize)
      : staged.kind === 'keep' && existing.photo
        ? formatByteSize(existing.photo.byteSize)
        : null

  // 新しく選んだ写真は既定値から始める。既存写真は保存済みの調整値が出発点
  const baseAdjust =
    staged.kind === 'keep' ? normalizePhotoAdjust(vehicle?.photoAdjust) : normalizePhotoAdjust(null)

  return {
    previewUrl,
    previewSize,
    adjust: stagedAdjust ?? baseAdjust,
    stageAdjust: (next: PhotoAdjust) => setStagedAdjust(clampPhotoAdjust(next)),
    loadingExisting:
      staged.kind === 'keep' && vehicle?.photoUpdatedAt !== undefined && existing.url === null,
    sizeNote,
    processing,
    showSpinner,
    error,
    pickFile,
    removePhoto,
    photoPatch:
      staged.kind === 'set' ? staged.processed : staged.kind === 'remove' ? null : undefined,
    // 削除予定のときは値を渡さない(写真の無い車両に調整値だけ残さない。
    // photo: null と同時に渡すと調整値の方が優先されてしまう)
    adjustPatch: staged.kind === 'remove' ? undefined : (stagedAdjust ?? undefined),
  }
}

/**
 * 写真ピッカー(5.15.4)。車両名の直下=任意項目の先頭に置く。
 *
 * - 未設定: 16:7の破線枠。**枠全体がタップ領域**で1タップ。`capture` は付けない
 *   (撮影・アルバムのどちらからでも選べるようにする)
 * - 設定済み: スクリム適用済みのヒーロープレビュー(ホームでの見え方)+ 44pxサムネプレビュー
 * - エラー: ダイアログを出さず枠内にアンバー表示(選び直しのみ)
 */
export function VehiclePhotoField({
  photo,
  vehicleType,
  isNew,
  onRequestRemove,
  onRequestAdjust,
}: {
  photo: StagedVehiclePhoto
  vehicleType: VehicleType
  isNew: boolean
  /** 「写真を削除」タップ(確認ダイアログは呼び出し側で出す) */
  onRequestRemove: () => void
  /** 「位置とサイズを調整」タップ(S-08a のシートは呼び出し側で開く) */
  onRequestAdjust: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const { previewUrl, previewSize, adjust, processing, showSpinner, error } = photo
  const busy = processing && showSpinner
  // 保存済みの写真が壊れている場合、**この画面でだけ**明示する(一覧・ホームは無言でフォールバック)
  const { failed: previewFailed, naturalSize, imgProps } = usePhotoLoadState(previewUrl)
  const displayError =
    error ?? (previewFailed ? '写真を読み込めませんでした。選び直してください' : null)

  // 実寸: 保存済みの値を優先し、持っていない古いレコードは読み込み時の実測で補う
  const size = firstUsableSize(previewSize, naturalSize)
  // 発見性のヒント(5.15.4): 既定で写真の70%未満しか映らない写真のときだけ出す。
  // **アンバー(警告色)は使わない** — 不具合ではなく仕様のため。
  // 調整済み(既定値以外)のときは出さない: 文面が事実と食い違ううえ、
  // 「一度きりのヒント」という位置づけにも反する(既定に戻せばまた出る)
  const showHint = shouldHintPhotoAdjust(size, HERO_FRAME) && isDefaultPhotoAdjust(adjust)
  const hintText =
    size && (size.height ?? 0) > (size.width ?? 0)
      ? '縦長の写真のため、一部だけが表示されます'
      : '横長の写真のため、一部だけが表示されます'

  const openPicker = () => inputRef.current?.click()

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    // 同じファイルを選び直せるように入力値をクリアしておく
    e.target.value = ''
    if (file) void photo.pickFile(file)
  }

  return (
    <div className="field photo-field">
      <label htmlFor="v-photo">
        車両の写真 <span className="opt">任意</span>
      </label>

      <input
        id="v-photo"
        ref={inputRef}
        type="file"
        accept="image/*"
        className="visually-hidden"
        onChange={handleChange}
        disabled={processing}
      />

      {previewUrl && !previewFailed ? (
        <>
          {/* ホームでの見え方: 実際のスクリムを適用して「暗く出る」ことを事前に伝える */}
          <div className="photo-hero">
            <PhotoFill
              url={previewUrl}
              alt="登録した写真のプレビュー"
              size={size}
              frame={HERO_FRAME}
              adjust={adjust}
              imgProps={imgProps}
            />
            <span className="scrim" />
            <span className="demo">
              <span className="lbl">直近の燃費</span>
              <span className="big num">
                19.2<small>km/L</small>
              </span>
            </span>
            {busy && (
              <span className="busy">
                <span className="spinner light" aria-hidden="true" />
                写真を準備しています…
              </span>
            )}
          </div>
          <div className="cap">ホームでの見え方(数値は例)</div>

          {/* 発見性のヒント(チップ全体がタップ領域)。グレー=不具合ではなく仕様 */}
          {showHint && (
            <button
              type="button"
              className="photo-hint"
              onClick={onRequestAdjust}
              disabled={processing}
            >
              <span className="t">{hintText}</span>
              <span className="a">調整する</span>
            </button>
          )}

          {/* 一覧・切り替えでの見え方 */}
          <div className="photo-thumbrow">
            <VehiclePhotoThumb
              type={vehicleType}
              hasPhoto
              url={previewUrl}
              adjust={adjust}
              size={size}
              loading="eager"
            />
            <span className="cap">一覧・切り替えでの見え方</span>
          </div>

          {/* 調整は「写真を選んだ直後に最も起きる操作」のため幅いっぱいの主導線にする */}
          <button
            type="button"
            className="btn secondary photo-adjust-btn"
            onClick={onRequestAdjust}
            disabled={processing}
          >
            <ExpandIcon size={20} />
            位置とサイズを調整
          </button>

          <div className="photo-acts">
            <button type="button" className="btn secondary sm" onClick={openPicker} disabled={processing}>
              写真を変更
            </button>
            <button type="button" className="btn danger-text sm" onClick={onRequestRemove} disabled={processing}>
              写真を削除
            </button>
          </div>
          {photo.sizeNote && <div className="hint num">保存サイズ {photo.sizeNote}</div>}
          {error && <div className="warnchip">{error}</div>}
        </>
      ) : (
        /* 枠全体がタップ領域(1タップでOSの選択シート) */
        <button
          type="button"
          className={`photo-slot${displayError ? ' err' : ''}`}
          onClick={openPicker}
          disabled={processing}
        >
          {busy ? (
            <>
              <span className="spinner" aria-hidden="true" />
              <span className="t">写真を準備しています…</span>
            </>
          ) : photo.loadingExisting ? null : (
            <>
              <PhotoIcon size={24} />
              <span className="t">写真を選ぶ</span>
              {displayError && <span className="err-msg">{displayError}</span>}
            </>
          )}
        </button>
      )}

      <div className="hint">
        撮影・アルバムのどちらからでも選べます{isNew ? '(あとから設定できます)' : ''}
      </div>
    </div>
  )
}
