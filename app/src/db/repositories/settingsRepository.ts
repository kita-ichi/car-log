/**
 * アプリ設定リポジトリ(選択中の車両IDなど。§4「車両切り替えの動線」)
 * settings テーブルにキーバリューで保存する。
 */
import { db, type AppDatabase } from '../database'
import type { AppSettings } from '../../types/models'

const KEY_SELECTED_VEHICLE_ID = 'selectedVehicleId'
const KEY_LAST_BACKUP_AT = 'lastBackupAt'

export function createSettingsRepository(database: AppDatabase) {
  return {
    /** 選択中の車両ID。未設定なら null */
    async getSelectedVehicleId(): Promise<string | null> {
      const entry = await database.settings.get(KEY_SELECTED_VEHICLE_ID)
      return typeof entry?.value === 'string' ? entry.value : null
    },

    /** 選択中の車両IDを保存(null でクリア)。次回起動時に復元される */
    async setSelectedVehicleId(vehicleId: string | null): Promise<void> {
      await database.settings.put({ key: KEY_SELECTED_VEHICLE_ID, value: vehicleId })
    },

    /** 最後にJSONバックアップした日時(ISO 8601)。未実施なら null(S-09 の表示用) */
    async getLastBackupAt(): Promise<string | null> {
      const entry = await database.settings.get(KEY_LAST_BACKUP_AT)
      return typeof entry?.value === 'string' ? entry.value : null
    },

    /** JSONバックアップ書き出し時に日時を記録する(F-11) */
    async setLastBackupAt(isoDateTime: string): Promise<void> {
      await database.settings.put({ key: KEY_LAST_BACKUP_AT, value: isoDateTime })
    },

    /** アプリ設定一式(将来の設定追加時はここに集約する) */
    async getAppSettings(): Promise<AppSettings> {
      return {
        selectedVehicleId: await this.getSelectedVehicleId(),
        lastBackupAt: await this.getLastBackupAt(),
      }
    },
  }
}

export type SettingsRepository = ReturnType<typeof createSettingsRepository>

/** アプリ本体で使うシングルトン */
export const settingsRepository = createSettingsRepository(db)
