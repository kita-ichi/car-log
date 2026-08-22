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
import { useEffect, useMemo, useState } from 'react'
import type { Vehicle, VehiclePhoto } from '../types/models'
import { vehicleRepository } from '../db/repositories'
import { createPhotoObjectUrl, revokePhotoObjectUrl } from './imageProcessing'
import { VehicleIcon } from './icons'

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
  vehicle,
  url,
  loading = 'lazy',
}: {
  vehicle: Vehicle
  url?: string | null
  /** 一覧は lazy、シート内は eager(開いた瞬間に見える必要がある) */
  loading?: 'lazy' | 'eager'
}) {
  const { shown, failed, imgProps } = usePhotoLoadState(url)
  // 写真があるはずだがまだ届いていない = 無地のスロット(アイコンを出すとチラつく)
  const pending = vehicle.photoUpdatedAt !== undefined && !shown && !failed

  return (
    <span className="vthumb" aria-hidden="true">
      {url && !failed && (
        <img
          src={url}
          alt=""
          loading={loading}
          className={`ph-img${shown ? ' on' : ''}`}
          {...imgProps}
        />
      )}
      {shown ? (
        <span className="tbadge">
          <VehicleIcon type={vehicle.vehicleType} size={12} />
        </span>
      ) : (
        !pending && <VehicleIcon type={vehicle.vehicleType} size={24} />
      )}
    </span>
  )
}
