/**
 * 車両リポジトリ(§5.1 Vehicle / S-08 車両管理)
 * - 削除APIは提供しない。手放した車両は archive() で非表示にする(記録は保持)
 */
import { db, type AppDatabase } from '../database'
import type { FuelType, Vehicle, VehicleType } from '../../types/models'
import { assertNumber, newId, nowIso, stripAbsent, toUpdatePatch } from './helpers'

/** 車両の新規登録入力(id・タイムスタンプ・アーカイブ状態は自動付与) */
export interface VehicleInput {
  name: string
  /** 省略時 'car' */
  vehicleType?: VehicleType
  /** 省略時 'regular' */
  fuelType?: FuelType
  /** 任意項目。未設定は省略または null */
  initialOdo?: number | null
  maker?: string | null
  model?: string | null
  firstRegistrationYm?: string | null
  tankCapacity?: number | null
  inspectionExpiry?: string | null
}

/**
 * 編集可能なフィールド(id・createdAt は変更不可)。
 * 任意項目(initialOdo / maker / model / firstRegistrationYm / tankCapacity / inspectionExpiry)は
 * null 指定で「クリア(値の削除)」、undefined(キー省略)で「変更なし」(§update系の共通契約)。
 */
export type VehicleUpdate = Partial<
  Omit<
    Vehicle,
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'initialOdo'
    | 'maker'
    | 'model'
    | 'firstRegistrationYm'
    | 'tankCapacity'
    | 'inspectionExpiry'
  >
> & {
  initialOdo?: number | null
  maker?: string | null
  model?: string | null
  firstRegistrationYm?: string | null
  tankCapacity?: number | null
  inspectionExpiry?: string | null
}

/** null 指定で「キー削除」扱いにする任意項目 */
const CLEARABLE_KEYS = [
  'initialOdo',
  'maker',
  'model',
  'firstRegistrationYm',
  'tankCapacity',
  'inspectionExpiry',
] as const

/**
 * create / update 入口の不変条件チェック(§6.1 不正データはこの層で弾く)。
 * undefined のフィールドは「未指定」としてチェックしない(update の変更なし)。
 */
function assertVehicleValues(values: {
  name?: string
  initialOdo?: number | null
  tankCapacity?: number | null
}): void {
  if (values.name !== undefined && values.name.trim() === '') {
    throw new Error('name(車両名)は空にできません')
  }
  assertNumber('initialOdo', values.initialOdo, { min: 0, nullable: true }) // 未設定可・null=クリア可。設定時は0以上
  assertNumber('tankCapacity', values.tankCapacity, { greaterThan: 0, nullable: true }) // null=クリア可
}

export function createVehicleRepository(database: AppDatabase) {
  return {
    /** 車両を登録して登録後のエンティティを返す */
    async create(input: VehicleInput): Promise<Vehicle> {
      assertVehicleValues(input)
      const now = nowIso()
      const vehicle: Vehicle = {
        id: newId(),
        createdAt: now,
        updatedAt: now,
        isArchived: false,
        vehicleType: input.vehicleType ?? 'car',
        fuelType: input.fuelType ?? 'regular',
        name: input.name,
        ...stripAbsent({
          initialOdo: input.initialOdo,
          maker: input.maker,
          model: input.model,
          firstRegistrationYm: input.firstRegistrationYm,
          tankCapacity: input.tankCapacity,
          inspectionExpiry: input.inspectionExpiry,
        }),
      }
      await database.vehicles.add(vehicle)
      return vehicle
    },

    async getById(id: string): Promise<Vehicle | undefined> {
      return database.vehicles.get(id)
    },

    /** アーカイブ済みを除いた車両一覧(登録順)。S-08 / S-11 用 */
    async listActive(): Promise<Vehicle[]> {
      const all = await database.vehicles.toArray()
      return all
        .filter((v) => !v.isArchived)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    },

    /** アーカイブ済みを含む全車両(エクスポート用) */
    async listAll(): Promise<Vehicle[]> {
      const all = await database.vehicles.toArray()
      return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    },

    /** 車両情報を更新して更新後のエンティティを返す */
    async update(id: string, patch: VehicleUpdate): Promise<Vehicle> {
      assertVehicleValues(patch)
      // null=クリア / undefined=変更なし の契約を Dexie パッチへ変換
      const changes = toUpdatePatch({ ...patch, updatedAt: nowIso() }, CLEARABLE_KEYS) as Partial<Vehicle>
      const updated = await database.vehicles.update(id, changes)
      if (updated === 0) throw new Error(`車両が見つかりません: ${id}`)
      return (await database.vehicles.get(id))!
    },

    /** 手放した車両を非表示にする(記録は保持・復元可能) */
    async archive(id: string): Promise<void> {
      await this.update(id, { isArchived: true })
    },

    /** アーカイブを解除する */
    async unarchive(id: string): Promise<void> {
      await this.update(id, { isArchived: false })
    },
  }
}

export type VehicleRepository = ReturnType<typeof createVehicleRepository>

/** アプリ本体で使うシングルトン */
export const vehicleRepository = createVehicleRepository(db)
