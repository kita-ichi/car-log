/**
 * 車両リポジトリ(§5.1 Vehicle / S-08 車両管理)
 * - 削除APIは提供しない。手放した車両は archive() で非表示にする(記録は保持)
 */
import { db, type AppDatabase } from '../database'
import type { FuelType, Vehicle, VehicleType } from '../../types/models'
import { newId, nowIso, stripUndefined } from './helpers'

/** 車両の新規登録入力(id・タイムスタンプ・アーカイブ状態は自動付与) */
export interface VehicleInput {
  name: string
  /** 登録時点のODO(km)。燃費計算の起点 */
  initialOdo: number
  /** 省略時 'car' */
  vehicleType?: VehicleType
  /** 省略時 'regular' */
  fuelType?: FuelType
  maker?: string
  model?: string
  firstRegistrationYm?: string
  tankCapacity?: number
  inspectionExpiry?: string
}

/** 編集可能なフィールド(id・createdAt は変更不可) */
export type VehicleUpdate = Partial<Omit<Vehicle, 'id' | 'createdAt' | 'updatedAt'>>

export function createVehicleRepository(database: AppDatabase) {
  return {
    /** 車両を登録して登録後のエンティティを返す */
    async create(input: VehicleInput): Promise<Vehicle> {
      const now = nowIso()
      const vehicle: Vehicle = {
        id: newId(),
        createdAt: now,
        updatedAt: now,
        isArchived: false,
        vehicleType: input.vehicleType ?? 'car',
        fuelType: input.fuelType ?? 'regular',
        ...stripUndefined({
          name: input.name,
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
      const changes = stripUndefined({ ...patch, updatedAt: nowIso() })
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
