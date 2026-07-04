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
  serializeBackup,
} from '../logic/export'

/** エクスポート1件分のダウンロード内容 */
export interface ExportPayload {
  filename: string
  content: string
  mimeType: string
}

interface ExportServiceDeps {
  vehicles: VehicleRepository
  fuelRecords: FuelRecordRepository
  maintenance: MaintenanceRepository
  settings: SettingsRepository
}

export function createExportService(deps: ExportServiceDeps) {
  return {
    /**
     * JSONバックアップ(全車両〔アーカイブ含む〕・全記録・設定)を生成し、
     * 最終バックアップ日時(lastBackupAt)を記録する。
     */
    async exportBackupJson(now: Date = new Date()): Promise<ExportPayload> {
      const [vehicles, fuelRecords, maintenanceRecords, settings] = await Promise.all([
        deps.vehicles.listAll(),
        deps.fuelRecords.listAll(),
        deps.maintenance.listAll(),
        deps.settings.getAppSettings(),
      ])
      const backup = buildBackup(
        { vehicles, fuelRecords, maintenanceRecords, settings },
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
