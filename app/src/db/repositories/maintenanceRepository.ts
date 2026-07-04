/**
 * メンテナンス記録リポジトリ(§5.3 MaintenanceRecord / S-05・S-06)
 */
import { db, type AppDatabase } from '../database'
import type { MaintenanceRecord, MaintenanceType } from '../../types/models'
import { assertNumber, newId, nowIso, stripAbsent, toUpdatePatch } from './helpers'

/** メンテナンス記録の新規作成入力 */
export interface MaintenanceRecordInput {
  vehicleId: string
  type: MaintenanceType
  /** type === 'other' のときの自由記述名。未設定は省略または null */
  typeLabel?: string | null
  /** 'YYYY-MM-DD' */
  date: string
  odo: number
  /** 費用(円)。0円可・不明は省略または null */
  cost?: number | null
  shopName?: string | null
  memo?: string | null
}

/**
 * 編集可能なフィールド。
 * 任意項目(typeLabel / shopName / memo)は null 指定で「クリア(値の削除)」、
 * undefined(キー省略)で「変更なし」(§update系の共通契約)。
 * 種別を「その他」→ 他種別へ変える場合は typeLabel: null を渡してラベルを消すこと。
 */
export type MaintenanceRecordUpdate = Partial<
  Omit<MaintenanceRecord, 'id' | 'createdAt' | 'updatedAt' | 'typeLabel' | 'shopName' | 'memo'>
> & {
  typeLabel?: string | null
  shopName?: string | null
  memo?: string | null
}

/** null 指定で「キー削除」扱いにする任意項目 */
const CLEARABLE_KEYS = ['typeLabel', 'shopName', 'memo'] as const

/**
 * create / update 入口の不変条件チェック(§6.1 不正データはこの層で弾く)。
 * undefined のフィールドは「未指定」としてチェックしない(update の変更なし)。
 */
function assertMaintenanceValues(values: { odo?: number | null; cost?: number | null }): void {
  assertNumber('odo', values.odo, { min: 0 })
  assertNumber('cost', values.cost, { min: 0, nullable: true }) // 0円可・不明(null)可
}

/** 一覧の並び: 日付降順 → 同日はODO降順(S-06) */
const byDateDesc = (a: MaintenanceRecord, b: MaintenanceRecord): number =>
  b.date.localeCompare(a.date) || b.odo - a.odo || b.createdAt.localeCompare(a.createdAt)

export function createMaintenanceRepository(database: AppDatabase) {
  return {
    async create(input: MaintenanceRecordInput): Promise<MaintenanceRecord> {
      assertMaintenanceValues(input)
      const now = nowIso()
      const record: MaintenanceRecord = {
        id: newId(),
        createdAt: now,
        updatedAt: now,
        vehicleId: input.vehicleId,
        type: input.type,
        date: input.date,
        odo: input.odo,
        cost: input.cost ?? null,
        ...stripAbsent({
          typeLabel: input.typeLabel,
          shopName: input.shopName,
          memo: input.memo,
        }),
      }
      await database.maintenanceRecords.add(record)
      return record
    },

    async getById(id: string): Promise<MaintenanceRecord | undefined> {
      return database.maintenanceRecords.get(id)
    },

    /** 車両のメンテ履歴(日付降順)。type 指定で種別フィルタ(S-06) */
    async listByVehicle(vehicleId: string, type?: MaintenanceType): Promise<MaintenanceRecord[]> {
      const records = type
        ? await database.maintenanceRecords
            .where('[vehicleId+type]')
            .equals([vehicleId, type])
            .toArray()
        : await database.maintenanceRecords.where('vehicleId').equals(vehicleId).toArray()
      return records.sort(byDateDesc)
    },

    /** 全車両のメンテ記録(エクスポート用・F-11)。時系列昇順 */
    async listAll(): Promise<MaintenanceRecord[]> {
      const records = await database.maintenanceRecords.toArray()
      return records.sort((a, b) => -byDateDesc(a, b))
    },

    /**
     * 同種別の最新実施記録(「前回オイル交換いつ?」/ リマインダー判定の基点)。
     * 無ければ undefined
     */
    async latestByType(
      vehicleId: string,
      type: MaintenanceType,
    ): Promise<MaintenanceRecord | undefined> {
      const records = await this.listByVehicle(vehicleId, type)
      return records[0]
    },

    async update(id: string, patch: MaintenanceRecordUpdate): Promise<MaintenanceRecord> {
      assertMaintenanceValues(patch)
      // null=クリア / undefined=変更なし の契約を Dexie パッチへ変換
      const changes = toUpdatePatch(
        { ...patch, updatedAt: nowIso() },
        CLEARABLE_KEYS,
      ) as Partial<MaintenanceRecord>
      const updated = await database.maintenanceRecords.update(id, changes)
      if (updated === 0) throw new Error(`メンテナンス記録が見つかりません: ${id}`)
      return (await database.maintenanceRecords.get(id))!
    },

    async remove(id: string): Promise<void> {
      await database.maintenanceRecords.delete(id)
    },
  }
}

export type MaintenanceRepository = ReturnType<typeof createMaintenanceRepository>

/** アプリ本体で使うシングルトン */
export const maintenanceRepository = createMaintenanceRepository(db)
