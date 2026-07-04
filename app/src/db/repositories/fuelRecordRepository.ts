/**
 * 給油記録リポジトリ(§5.2 FuelRecord / S-02〜S-04)
 *
 * 燃費キャッシュ(fuelEconomy)の整合性はこの層が保証する:
 * 追加・編集・削除のたびに対象車両の全記録で満タン法を再計算し、
 * 変化した記録だけを同一トランザクション内で書き戻す(要件 §6.1)。
 */
import { db, type AppDatabase } from '../database'
import type { FuelRecord } from '../../types/models'
import {
  computeTotalPrice,
  computeUnitPrice,
  diffFuelEconomies,
  sortRecordsChronologically,
} from '../../logic/fuelEconomy'
import { assertNumber, newId, nowIso, stripAbsent, toUpdatePatch } from './helpers'

/** 給油記録の新規作成入力 */
export interface FuelRecordInput {
  vehicleId: string
  /** 'YYYY-MM-DD' */
  date: string
  odo: number
  fuelAmount: number
  /** 任意。総額入力が既定。未入力は省略または null */
  totalPrice?: number | null
  /** 単価側から入力された場合に指定(総額は自動逆算)。通常は省略 */
  unitPrice?: number | null
  /** 省略時 true(満タン) */
  isFullTank?: boolean
  /** 未設定は省略または null */
  stationName?: string | null
  memo?: string | null
}

/**
 * 編集可能なフィールド。
 * 任意項目(stationName / memo)は null 指定で「クリア(値の削除)」、
 * undefined(キー省略)で「変更なし」(§update系の共通契約)。
 */
export type FuelRecordUpdate = Partial<
  Omit<FuelRecord, 'id' | 'createdAt' | 'updatedAt' | 'fuelEconomy' | 'stationName' | 'memo'>
> & {
  stationName?: string | null
  memo?: string | null
}

/** null 指定で「キー削除」扱いにする任意項目 */
const CLEARABLE_KEYS = ['stationName', 'memo'] as const

/**
 * create / update 入口の不変条件チェック(§6.1 不正データはこの層で弾く)。
 * undefined のフィールドは「未指定」としてチェックしない(update の変更なし)。
 */
function assertFuelRecordValues(values: {
  odo?: number | null
  fuelAmount?: number | null
  totalPrice?: number | null
  unitPrice?: number | null
}): void {
  assertNumber('odo', values.odo, { min: 0 })
  assertNumber('fuelAmount', values.fuelAmount, { greaterThan: 0 })
  assertNumber('totalPrice', values.totalPrice, { min: 0, nullable: true })
  assertNumber('unitPrice', values.unitPrice, { min: 0, nullable: true })
}

/**
 * 金額(総額・単価)の正規化(§5.2):
 * - 総額あり → 単価を自動算出(両方保持)
 * - 単価のみ → 総額を逆算(両方保持)
 * - どちらも無し → 両方 null
 */
function normalizePrices(
  fuelAmount: number,
  totalPrice: number | null | undefined,
  unitPrice: number | null | undefined,
): { totalPrice: number | null; unitPrice: number | null } {
  if (totalPrice !== null && totalPrice !== undefined) {
    return { totalPrice, unitPrice: computeUnitPrice(totalPrice, fuelAmount) }
  }
  if (unitPrice !== null && unitPrice !== undefined) {
    return { totalPrice: computeTotalPrice(unitPrice, fuelAmount), unitPrice }
  }
  return { totalPrice: null, unitPrice: null }
}

export function createFuelRecordRepository(database: AppDatabase) {
  /** 対象車両の燃費キャッシュを再計算し、差分だけ書き戻す(トランザクション内で呼ぶ) */
  async function recalculateVehicle(vehicleId: string): Promise<void> {
    const records = await database.fuelRecords.where('vehicleId').equals(vehicleId).toArray()
    const changes = diffFuelEconomies(records)
    for (const change of changes) {
      await database.fuelRecords.update(change.id, { fuelEconomy: change.fuelEconomy })
    }
  }

  return {
    /** 給油記録を追加し、影響区間の燃費を再計算。保存後のエンティティ(算出燃費入り)を返す */
    async create(input: FuelRecordInput): Promise<FuelRecord> {
      assertFuelRecordValues(input)
      const now = nowIso()
      const prices = normalizePrices(input.fuelAmount, input.totalPrice, input.unitPrice)
      const record: FuelRecord = {
        id: newId(),
        createdAt: now,
        updatedAt: now,
        vehicleId: input.vehicleId,
        date: input.date,
        odo: input.odo,
        fuelAmount: input.fuelAmount,
        totalPrice: prices.totalPrice,
        unitPrice: prices.unitPrice,
        isFullTank: input.isFullTank ?? true,
        fuelEconomy: null,
        ...stripAbsent({ stationName: input.stationName, memo: input.memo }),
      }
      return database.transaction('rw', database.fuelRecords, async () => {
        await database.fuelRecords.add(record)
        await recalculateVehicle(record.vehicleId)
        return (await database.fuelRecords.get(record.id))!
      })
    },

    async getById(id: string): Promise<FuelRecord | undefined> {
      return database.fuelRecords.get(id)
    },

    /**
     * 車両の給油記録一覧。既定は日付降順(S-03 給油履歴)。
     * order: 'asc' で時系列昇順(グラフ・計算用)
     */
    async listByVehicle(vehicleId: string, order: 'asc' | 'desc' = 'desc'): Promise<FuelRecord[]> {
      const records = await database.fuelRecords.where('vehicleId').equals(vehicleId).toArray()
      const sorted = sortRecordsChronologically(records)
      return order === 'desc' ? sorted.reverse() : sorted
    },

    /** 車両の最新の給油記録(前回値ヒント・現在ODO推定に使用)。無ければ undefined */
    async latestByVehicle(vehicleId: string): Promise<FuelRecord | undefined> {
      const records = await this.listByVehicle(vehicleId, 'desc')
      return records[0]
    },

    /**
     * 給油記録を編集し、影響区間の燃費を再計算(S-04)。
     * 金額関連(totalPrice / unitPrice / fuelAmount)が変わった場合は単価・総額を正規化し直す。
     */
    async update(id: string, patch: FuelRecordUpdate): Promise<FuelRecord> {
      assertFuelRecordValues(patch)
      return database.transaction('rw', database.fuelRecords, async () => {
        const current = await database.fuelRecords.get(id)
        if (!current) throw new Error(`給油記録が見つかりません: ${id}`)

        // null=クリア / undefined=変更なし の契約を Dexie パッチへ変換
        const changes = toUpdatePatch({ ...patch, updatedAt: nowIso() }, CLEARABLE_KEYS) as Partial<FuelRecord>

        // 金額の正規化: パッチで明示された側を入力源として再計算する
        const priceTouched =
          'totalPrice' in patch || 'unitPrice' in patch || 'fuelAmount' in patch
        if (priceTouched) {
          const fuelAmount = patch.fuelAmount ?? current.fuelAmount
          let source: { totalPrice?: number | null; unitPrice?: number | null }
          if ('totalPrice' in patch && patch.totalPrice != null) {
            source = { totalPrice: patch.totalPrice } // 総額が入力された → 総額を優先
          } else if ('unitPrice' in patch && patch.unitPrice != null) {
            source = { unitPrice: patch.unitPrice } // 単価側から入力された
          } else if ('totalPrice' in patch || 'unitPrice' in patch) {
            source = {} // 金額のクリア(null 指定)→ 両方 null
          } else {
            source = { totalPrice: current.totalPrice } // 給油量のみ変更 → 既存総額から単価を再計算
          }
          const prices = normalizePrices(fuelAmount, source.totalPrice, source.unitPrice)
          changes.totalPrice = prices.totalPrice
          changes.unitPrice = prices.unitPrice
        }

        await database.fuelRecords.update(id, changes)

        // 車両を移した場合は移動元・移動先の両方を再計算
        await recalculateVehicle(current.vehicleId)
        if (patch.vehicleId && patch.vehicleId !== current.vehicleId) {
          await recalculateVehicle(patch.vehicleId)
        }
        return (await database.fuelRecords.get(id))!
      })
    },

    /** 給油記録を削除し、前後区間の燃費を再計算(S-04 削除) */
    async remove(id: string): Promise<void> {
      await database.transaction('rw', database.fuelRecords, async () => {
        const current = await database.fuelRecords.get(id)
        if (!current) return
        await database.fuelRecords.delete(id)
        await recalculateVehicle(current.vehicleId)
      })
    },
  }
}

export type FuelRecordRepository = ReturnType<typeof createFuelRecordRepository>

/** アプリ本体で使うシングルトン */
export const fuelRecordRepository = createFuelRecordRepository(db)
