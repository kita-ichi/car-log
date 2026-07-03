/**
 * 表示用フォーマッタ(UI層のみで使用)
 * 単位・小数桁の統一: 燃費=小数1桁 km/L / 給油量=小数2桁 L / 金額=整数 円 / 距離=整数 km
 */
import type { FuelType, MaintenanceType, VehicleType } from '../types/models'

/** 3桁区切り(整数) */
export const fmtInt = (n: number): string => Math.round(n).toLocaleString('ja-JP')

/** 距離(km)表示用 — 3桁区切り整数 */
export const fmtKm = (n: number): string => fmtInt(n)

/** 燃費(km/L)— 小数1桁。null は「—」 */
export const fmtEconomy = (n: number | null | undefined): string =>
  n === null || n === undefined ? '—' : n.toFixed(1)

/** 給油量(L)— 小数2桁 */
export const fmtLiters = (n: number): string => n.toFixed(2)

/** 金額(円)— 「¥1,234」。null は「¥ —」 */
export const fmtYen = (n: number | null | undefined): string =>
  n === null || n === undefined ? '¥ —' : `¥${fmtInt(n)}`

/** 単価(円/L)— 「@160円/L」。null は「@— 円/L」 */
export const fmtUnitPrice = (n: number | null | undefined): string =>
  n === null || n === undefined ? '@— 円/L' : `@${n}円/L`

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const

/** 'YYYY-MM-DD' → Date(ローカルタイム) */
const parseDate = (date: string): Date => {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** 'YYYY-MM-DD' → 「7/1」 */
export const fmtMonthDay = (date: string): string => {
  const d = parseDate(date)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

/** 'YYYY-MM-DD' → 「水」 */
export const fmtWeekday = (date: string): string => WEEKDAYS[parseDate(date).getDay()]

/** 'YYYY-MM-DD' → 「2026/07/01」 */
export const fmtDateFull = (date: string): string => date.replaceAll('-', '/')

/** 今日('YYYY-MM-DD'・ローカルタイム) */
export const todayString = (): string => {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

/** 今日 → 「7/3(金)」(ホームのヘッダ表示) */
export const todayLabel = (): string => {
  const d = new Date()
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]})`
}

/** 車両タイプの表示名 */
export const vehicleTypeLabel = (t: VehicleType): string => (t === 'motorcycle' ? 'バイク' : '車')

/** 燃料種別の表示名 */
export const fuelTypeLabel = (t: FuelType): string =>
  t === 'premium' ? 'ハイオク' : t === 'diesel' ? '軽油' : 'レギュラー'

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
