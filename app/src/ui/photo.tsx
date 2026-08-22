/**
 * 愛車の写真(F-22)の共通UI部品(デザインガイド 5.15 / 画面設計書 §0.4)
 * - 写真の読み込み(ObjectURL の生成と解放)を行うフック
 * - 44pxサムネイル(S-08 一覧 / S-11 切り替えシート)
 *
 * 方針:
 * - 写真の**有無**は `vehicle.photoUpdatedAt` で判定する(DBを触らない)。
 *   画像を実際に表示するときだけ `getPhoto` / `getPhotos` を呼ぶ
 * - 一覧では行ごとに `getPhoto` を呼ばず `getPhotos(ids)` で一括取得する
 * - 作った ObjectURL は必ず解放する(useEffect のクリーンアップ)
 * - 読み込み失敗は**無言でフォールバック**(タイプアイコン / 無地ネイビー)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Vehicle, VehiclePhoto, VehicleType } from '../types/models'
import { vehicleRepository, type PhotoAssignment } from '../db/repositories'
import { ImageError, formatByteSize, formatCompressionNote } from '../logic/image'
import {
  createPhotoObjectUrl,
  processVehiclePhoto,
  revokePhotoObjectUrl,
  type ProcessedImage,
} from './imageProcessing'
import { PhotoIcon, VehicleIcon } from './icons'

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

/**
 * `<img>` の読み込み状態(5.15.5)。
 * - 到着したら `shown` が true になる(呼び出し側でフェードイン用のクラスを付ける)
 * - 失敗したら `failed`。**エラー表示はせず**タイプアイコン/無地ネイビーに戻す
 */
export function usePhotoLoadState(url: string | null | undefined): {
  shown: boolean
  failed: boolean
  imgProps: { onLoad: () => void; onError: () => void; decoding: 'async' }
} {
  // 結果は URL とセットで持つ。写真を差し替えた直後に前の結果を引きずらない
  const [result, setResult] = useState<{ url: string; status: 'loaded' | 'failed' } | null>(null)
  const status = url && result?.url === url ? result.status : 'loading'

  return {
    shown: status === 'loaded',
    failed: status === 'failed',
    imgProps: {
      onLoad: () => url && setResult({ url, status: 'loaded' }),
      onError: () => url && setResult({ url, status: 'failed' }),
      decoding: 'async',
    },
  }
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
 * 装飾のため `aria-hidden`(車両名テキスト・行の aria-label が情報を担う)。
 */
export function VehiclePhotoThumb({
  type,
  hasPhoto,
  url,
  loading = 'lazy',
}: {
  type: VehicleType
  /** 写真が設定されているか(`vehicle.photoUpdatedAt !== undefined`) */
  hasPhoto: boolean
  url?: string | null
  /** 一覧は lazy、シート内は eager(開いた瞬間に見える必要がある) */
  loading?: 'lazy' | 'eager'
}) {
  const { shown, failed, imgProps } = usePhotoLoadState(url)
  // 写真があるはずだがまだ届いていない = 無地のスロット(アイコンを出すとチラつく)
  const pending = hasPhoto && !shown && !failed

  return (
    <span className="vthumb" aria-hidden="true">
      {url && !failed && (
        <img
          src={url}
          alt=""
          loading={loading}
          className={`ph-fade${shown ? ' on' : ''}`}
          {...imgProps}
        />
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
  const [processing, setProcessing] = useState(false)
  const [showSpinner, setShowSpinner] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const stagedUrlRef = useRef<string | null>(null)

  /** 保留中の写真を差し替える(前の ObjectURL は必ず解放する) */
  const replaceStaged = useCallback((next: StagedPhoto) => {
    revokePhotoObjectUrl(stagedUrlRef.current)
    stagedUrlRef.current = next.kind === 'set' ? next.url : null
    setStaged(next)
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

  const sizeNote =
    staged.kind === 'set'
      ? formatCompressionNote(staged.processed.sourceByteSize, staged.processed.byteSize)
      : staged.kind === 'keep' && existing.photo
        ? formatByteSize(existing.photo.byteSize)
        : null

  return {
    previewUrl,
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
}: {
  photo: StagedVehiclePhoto
  vehicleType: VehicleType
  isNew: boolean
  /** 「写真を削除」タップ(確認ダイアログは呼び出し側で出す) */
  onRequestRemove: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const { previewUrl, processing, showSpinner, error } = photo
  const busy = processing && showSpinner
  // 保存済みの写真が壊れている場合、**この画面でだけ**明示する(一覧・ホームは無言でフォールバック)
  const { failed: previewFailed, imgProps } = usePhotoLoadState(previewUrl)
  const displayError =
    error ?? (previewFailed ? '写真を読み込めませんでした。選び直してください' : null)

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
            <img src={previewUrl} alt="登録した写真のプレビュー" {...imgProps} />
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

          {/* 一覧・切り替えでの見え方 */}
          <div className="photo-thumbrow">
            <VehiclePhotoThumb type={vehicleType} hasPhoto url={previewUrl} loading="eager" />
            <span className="cap">一覧・切り替えでの見え方</span>
          </div>

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
