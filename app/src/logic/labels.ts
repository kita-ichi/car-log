/**
 * ドメイン語彙の日本語ラベル(§5.3)
 *
 * UI表示とデータエクスポート(CSV)の両方で使うため logic 層に置く
 * (ui/format.ts から再エクスポートしており、UI側の import 経路は従来どおり)。
 */
import type { MaintenanceType } from '../types/models'

/** メンテナンス種別の表示名(§5.3) */
export const MAINTENANCE_TYPE_LABELS: Record<MaintenanceType, string> = {
  oil_change: 'オイル交換',
  oil_filter: 'オイルフィルタ',
  tire_change: 'タイヤ交換',
  tire_rotation: 'タイヤローテーション',
  shaken: '車検',
  legal_inspection: '法定点検',
  battery: 'バッテリー交換',
  wiper: 'ワイパー交換',
  other: 'その他',
}

/** メンテ記録の表示名(その他は typeLabel を優先) */
export const maintenanceLabel = (type: MaintenanceType, typeLabel?: string): string =>
  type === 'other' && typeLabel ? typeLabel : MAINTENANCE_TYPE_LABELS[type]
