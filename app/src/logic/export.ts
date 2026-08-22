/**
 * F-11 データエクスポート(純粋関数)
 * 参照: docs/要件定義書.md F-11 / §7 非機能要件(データ保存・データ耐久性)
 *
 * - JSON: 全データの完全バックアップ。フェーズ2のインポート(F-15)で
 *   そのまま復元できるよう、エンティティを無加工で格納し、メタ情報
 *   (format / schemaVersion / exportedAt)を付ける
 * - CSV: 給油記録・メンテ記録の2種類。人間が表計算ソフトで見る用
 *   (ヘッダ日本語・車両名列あり・Excel向けBOM付きUTF-8・CRLF)
 *
 * この層はデータ取得(DB)・ダウンロード(UI)に依存しない。
 * 取得と保存日時の記録は db/exportService.ts、ダウンロードは ui/download.ts が担う。
 */
import type { AppSettings, FuelRecord, MaintenanceRecord, Vehicle, VehiclePhoto } from '../types/models'
import { base64ToBytes, bytesToBase64 } from './base64'
import { maintenanceLabel } from './labels'

// ---------------------------------------------------------------------------
// JSON バックアップ
// ---------------------------------------------------------------------------

/** バックアップファイルの format 識別子(インポート時の判定に使う) */
export const BACKUP_FORMAT = 'car-maintenance-app-backup' as const

/**
 * バックアップのスキーマバージョン。
 * エンティティの形(types/models.ts)や DB スキーマが変わったら +1 し、
 * インポート(F-15)側で旧バージョンからの変換を実装する。
 *
 * - 1: 初版(2026-07-05)
 * - 2: 愛車の写真(F-22)に対応。Vehicle.photoUpdatedAt / data.vehiclePhotos が増えた。
 *      v1 のファイルは「写真なしのバックアップ」としてそのまま読める(追加のみのため)
 */
export const BACKUP_SCHEMA_VERSION = 2

/**
 * バックアップに入れる写真1枚(F-22)。
 * JSON はバイナリを運べないため画像を Base64 文字列にして格納する。
 */
export interface VehiclePhotoBackup {
  vehicleId: string
  mimeType: string
  /** 元のバイト数(復元時の整合チェックに使う) */
  byteSize: number
  width?: number
  height?: number
  updatedAt: string
  /** 画像本体(Base64。Data URL ではなく本体のみ) */
  dataBase64: string
}

/** バックアップに含める全データ */
export interface BackupData {
  /** アーカイブ済みを含む全車両 */
  vehicles: Vehicle[]
  fuelRecords: FuelRecord[]
  maintenanceRecords: MaintenanceRecord[]
  settings: AppSettings
  /**
   * 愛車の写真(F-22)。**「写真を含めない」でエクスポートした場合はキーごと存在しない**。
   * 空配列 = 写真を含めたが1枚も無い、undefined = 写真を書き出していない、の区別が付く
   * (インポート時に既存の写真を消してよいかの判断に使う)。
   */
  vehiclePhotos?: VehiclePhotoBackup[]
}

/** JSONバックアップファイルの構造 */
export interface BackupFile {
  format: typeof BACKUP_FORMAT
  schemaVersion: number
  /** エクスポート日時(ISO 8601) */
  exportedAt: string
  /** 写真を含めて書き出したか(false なら data.vehiclePhotos は無い) */
  includesPhotos: boolean
  data: BackupData
}

/** バックアップオブジェクトを組み立てる(データは無加工で格納する) */
export function buildBackup(data: BackupData, exportedAt: string): BackupFile {
  return {
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt,
    includesPhotos: data.vehiclePhotos !== undefined,
    data,
  }
}

/**
 * 写真(メタ情報 + 画像バイト列)をバックアップ用のエントリに変換する。
 * Blob の読み出し(非同期)は呼び出し側(db/exportService.ts)で済ませておく。
 */
export function photoToBackup(photo: Omit<VehiclePhoto, 'blob'>, bytes: Uint8Array): VehiclePhotoBackup {
  return {
    vehicleId: photo.vehicleId,
    mimeType: photo.mimeType,
    byteSize: bytes.length,
    ...(photo.width !== undefined ? { width: photo.width } : {}),
    ...(photo.height !== undefined ? { height: photo.height } : {}),
    updatedAt: photo.updatedAt,
    dataBase64: bytesToBase64(bytes),
  }
}

/**
 * バックアップのエントリから画像バイト列を復元する(F-15 インポート用)。
 * バイト数が記録と食い違う場合はファイルが壊れているとみなしてエラーにする。
 */
export function backupToPhotoBytes(entry: VehiclePhotoBackup): Uint8Array {
  const bytes = base64ToBytes(entry.dataBase64)
  if (typeof entry.byteSize === 'number' && entry.byteSize !== bytes.length) {
    throw new Error(
      `写真データが壊れています(${entry.vehicleId}: ${entry.byteSize}バイトのはずが${bytes.length}バイト)`,
    )
  }
  return bytes
}

/** バックアップをJSON文字列にする(人間も読めるよう整形) */
export function serializeBackup(backup: BackupFile): string {
  return JSON.stringify(backup, null, 2)
}

// ---------------------------------------------------------------------------
// CSV 共通
// ---------------------------------------------------------------------------

/**
 * BOM(バイトオーダーマーク)。
 * Excel は BOM が無いと UTF-8 の CSV を Shift_JIS と誤認して文字化けするため、
 * CSV 文字列の先頭に必ず付ける。
 */
export const CSV_BOM = '\uFEFF'

/** Excel 互換の行区切り(RFC 4180 は CRLF) */
const CSV_EOL = '\r\n'

/**
 * CSVフィールドのエスケープ:
 * - 数値はそのまま文字列化、null/undefined は空欄
 * - 数式インジェクション対策: ユーザー入力文字列が = + - @ タブ CR で始まる場合、
 *   先頭にシングルクォートを付けて数式として解釈されないようにする
 * - カンマ・改行・ダブルクォートを含む場合はダブルクォートで囲み、
 *   中のダブルクォートは2つ重ねにする(RFC 4180)
 */
export function csvField(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'

  let text = value
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  if (/[",\r\n]/.test(text)) text = `"${text.replaceAll('"', '""')}"`
  return text
}

/** CSVの1セルに入れる生値(エスケープは toCsv が一括で行う) */
type CsvValue = string | number | boolean | null | undefined

/** 行の配列 → BOM付きCSV文字列(エスケープはここで1回だけ行う) */
function toCsv(rows: readonly CsvValue[][]): string {
  return CSV_BOM + rows.map((row) => row.map(csvField).join(',')).join(CSV_EOL)
}

/** 車両ID → 車両名の解決。記録に車両が見つからない場合は空欄(通常は起こらない) */
function vehicleNameResolver(vehicles: readonly Vehicle[]): (vehicleId: string) => string {
  const names = new Map(vehicles.map((v) => [v.id, v.name]))
  return (vehicleId) => names.get(vehicleId) ?? ''
}

/** 車両の並び順(vehicles 配列の順)→ 同一車両内は時系列昇順、で記録を並べる */
function sortByVehicleThenDate<T extends { vehicleId: string }>(
  vehicles: readonly Vehicle[],
  records: readonly T[],
  compare: (a: T, b: T) => number,
): T[] {
  const order = new Map(vehicles.map((v, i) => [v.id, i]))
  const rank = (r: T) => order.get(r.vehicleId) ?? vehicles.length
  return [...records].sort((a, b) => rank(a) - rank(b) || compare(a, b))
}

// ---------------------------------------------------------------------------
// 給油記録 CSV
// ---------------------------------------------------------------------------

/** 給油記録CSVのヘッダ(表計算で見る人向けに日本語) */
export const FUEL_CSV_HEADER = [
  '日付',
  '車両名',
  'ODO(km)',
  '給油量(L)',
  '単価(円/L)',
  '金額(円)',
  '満タン',
  '燃費(km/L)',
  '給油所',
  'メモ',
] as const

/**
 * 給油記録CSVを生成する(BOM付きUTF-8・CRLF)。
 * 並び: 車両ごと(vehicles の並び順)に時系列昇順。
 * 金額・単価・燃費が無い記録は空欄。満タンは「満タン」/「部分給油」。
 */
export function buildFuelCsv(vehicles: readonly Vehicle[], records: readonly FuelRecord[]): string {
  const nameOf = vehicleNameResolver(vehicles)
  const sorted = sortByVehicleThenDate(
    vehicles,
    records,
    // sortRecordsChronologically(fuelEconomy.ts)と同じ時系列順
    (a, b) =>
      a.date.localeCompare(b.date) || a.odo - b.odo || a.createdAt.localeCompare(b.createdAt),
  )
  const rows: CsvValue[][] = [[...FUEL_CSV_HEADER]]
  for (const r of sorted) {
    rows.push([
      r.date,
      nameOf(r.vehicleId),
      r.odo,
      r.fuelAmount,
      r.unitPrice,
      r.totalPrice,
      r.isFullTank ? '満タン' : '部分給油',
      r.fuelEconomy,
      r.stationName ?? '',
      r.memo ?? '',
    ])
  }
  return toCsv(rows)
}

// ---------------------------------------------------------------------------
// メンテナンス記録 CSV
// ---------------------------------------------------------------------------

/** メンテ記録CSVのヘッダ */
export const MAINTENANCE_CSV_HEADER = [
  '日付',
  '車両名',
  '種別',
  'ODO(km)',
  '費用(円)',
  '店舗',
  'メモ',
] as const

/**
 * メンテナンス記録CSVを生成する(BOM付きUTF-8・CRLF)。
 * 並び: 車両ごと(vehicles の並び順)に時系列昇順。
 * 種別は日本語ラベル(「その他」は自由記述名を優先)。費用不明(null)は空欄、0円は 0。
 */
export function buildMaintenanceCsv(
  vehicles: readonly Vehicle[],
  records: readonly MaintenanceRecord[],
): string {
  const nameOf = vehicleNameResolver(vehicles)
  const sorted = sortByVehicleThenDate(
    vehicles,
    records,
    (a, b) =>
      a.date.localeCompare(b.date) || a.odo - b.odo || a.createdAt.localeCompare(b.createdAt),
  )
  const rows: CsvValue[][] = [[...MAINTENANCE_CSV_HEADER]]
  for (const r of sorted) {
    rows.push([
      r.date,
      nameOf(r.vehicleId),
      maintenanceLabel(r.type, r.typeLabel),
      r.odo,
      r.cost,
      r.shopName ?? '',
      r.memo ?? '',
    ])
  }
  return toCsv(rows)
}

// ---------------------------------------------------------------------------
// ファイル名
// ---------------------------------------------------------------------------

/** Date → 'YYYY-MM-DD'(ローカルタイム)。ファイル名用 */
export function localDateString(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

/** 例: car-log-backup-2026-07-04.json */
export const backupFileName = (dateStr: string): string => `car-log-backup-${dateStr}.json`

/** 例: car-log-fuel-records-2026-07-04.csv */
export const fuelCsvFileName = (dateStr: string): string => `car-log-fuel-records-${dateStr}.csv`

/** 例: car-log-maintenance-records-2026-07-04.csv */
export const maintenanceCsvFileName = (dateStr: string): string =>
  `car-log-maintenance-records-${dateStr}.csv`
