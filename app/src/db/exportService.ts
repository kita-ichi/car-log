/**
 * F-11 データエクスポートサービス
 * リポジトリから全データを集めて、logic/export.ts の純粋関数でファイル内容を作る。
 * ダウンロード(Blob / a[download])は UI 層(ui/download.ts)が担当。
 *
 * 使い方(S-09):
 *   const payload = await exportService.exportBackupJson()
 *   downloadTextFile(payload)  // ui/download.ts
 */
import {
  fuelRecordRepository,
  maintenanceRepository,
  settingsRepository,
  vehicleRepository,
  type FuelRecordRepository,
  type MaintenanceRepository,
  type SettingsRepository,
  type VehicleRepository,
} from './repositories'
import {
  backupFileName,
  buildBackup,
  buildFuelCsv,
  buildMaintenanceCsv,
  fuelCsvFileName,
  localDateString,
  maintenanceCsvFileName,
  photoToBackup,
  serializeBackup,
  type VehiclePhotoBackup,
} from '../logic/export'

/** エクスポート1件分のダウンロード内容 */
export interface ExportPayload {
  filename: string
  content: string
  mimeType: string
}

/** JSONバックアップのオプション */
export interface BackupJsonOptions {
  /**
   * 愛車の写真(F-22)を Base64 で含めるか。既定 **true**
   * (バックアップは「これ1つで完全復元できる」ことが原則のため)。
   *
   * 写真は Base64 化でバイト数が約4/3になり、1枚あたり 150〜400KB 程度に
   * なるため、ファイルを軽くしたい場合に false を指定する。
   * false で書き出したファイルには写真が入らない(復元しても写真は戻らない)。
   */
  includePhotos?: boolean
}

interface ExportServiceDeps {
  vehicles: VehicleRepository
  fuelRecords: FuelRecordRepository
  maintenance: MaintenanceRepository
  settings: SettingsRepository
}

/**
 * 全車両の写真を読み出して Base64 のバックアップエントリに変換する。
 * Blob → バイト列の読み出しだけがここの仕事で、Base64 化は logic/export.ts の純粋関数。
 */
async function collectPhotoBackups(vehicles: VehicleRepository): Promise<VehiclePhotoBackup[]> {
  const photos = await vehicles.listAllPhotos()
  return Promise.all(
    photos.map(async ({ blob, ...meta }) => photoToBackup(meta, new Uint8Array(await blob.arrayBuffer()))),
  )
}

export function createExportService(deps: ExportServiceDeps) {
  return {
    /**
     * JSONバックアップ(全車両〔アーカイブ含む〕・全記録・設定・愛車の写真)を生成し、
     * 最終バックアップ日時(lastBackupAt)を記録する。
     *
     * @param now テスト・ファイル名用の基準日時
     * @param options `{ includePhotos: false }` で写真を除いた軽いファイルにできる
     */
    async exportBackupJson(
      now: Date = new Date(),
      options: BackupJsonOptions = {},
    ): Promise<ExportPayload> {
      const includePhotos = options.includePhotos ?? true
      const [vehicles, fuelRecords, maintenanceRecords, settings, vehiclePhotos] = await Promise.all([
        deps.vehicles.listAll(),
        deps.fuelRecords.listAll(),
        deps.maintenance.listAll(),
        deps.settings.getAppSettings(),
        includePhotos ? collectPhotoBackups(deps.vehicles) : Promise.resolve(undefined),
      ])
      const backup = buildBackup(
        { vehicles, fuelRecords, maintenanceRecords, settings, vehiclePhotos },
        now.toISOString(),
      )
      const payload: ExportPayload = {
        filename: backupFileName(localDateString(now)),
        content: serializeBackup(backup),
        mimeType: 'application/json',
      }
      // 完全バックアップ(JSON)のみを「最終バックアップ」として記録する(CSVは閲覧用)
      await deps.settings.setLastBackupAt(now.toISOString())
      return payload
    },

    /** 給油記録CSV(全車両・BOM付きUTF-8)を生成する */
    async exportFuelCsv(now: Date = new Date()): Promise<ExportPayload> {
      const [vehicles, fuelRecords] = await Promise.all([
        deps.vehicles.listAll(),
        deps.fuelRecords.listAll(),
      ])
      return {
        filename: fuelCsvFileName(localDateString(now)),
        content: buildFuelCsv(vehicles, fuelRecords),
        mimeType: 'text/csv',
      }
    },

    /** メンテナンス記録CSV(全車両・BOM付きUTF-8)を生成する */
    async exportMaintenanceCsv(now: Date = new Date()): Promise<ExportPayload> {
      const [vehicles, maintenanceRecords] = await Promise.all([
        deps.vehicles.listAll(),
        deps.maintenance.listAll(),
      ])
      return {
        filename: maintenanceCsvFileName(localDateString(now)),
        content: buildMaintenanceCsv(vehicles, maintenanceRecords),
        mimeType: 'text/csv',
      }
    },
  }
}

export type ExportService = ReturnType<typeof createExportService>

/** アプリ本体で使うシングルトン */
export const exportService = createExportService({
  vehicles: vehicleRepository,
  fuelRecords: fuelRecordRepository,
  maintenance: maintenanceRepository,
  settings: settingsRepository,
})
