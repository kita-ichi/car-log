import Dexie, { type Table } from 'dexie'
import type { FuelRecord, MaintenanceRecord, Vehicle, VehiclePhoto } from '../types/models'

/** settings テーブルのキーバリューエントリ */
export interface SettingEntry {
  key: string
  value: unknown
}

/**
 * アプリのローカルDB(IndexedDB / Dexie)
 *
 * スキーマ変更の手順:
 *   1. 下に `this.version(N + 1).stores({...}).upgrade(tx => {...})` を「追記」する
 *      (既存の version(N) 定義は削除しない — Dexie が差分マイグレーションを行う)
 *   2. インデックスの追加・削除のみなら upgrade() は不要
 *   3. スキーマ変更をした場合は docs/実装メモ.md の履歴も更新する
 *
 * インデックス方針: `id` を主キーに、一覧取得で使う vehicleId / date の複合
 * インデックスを持たせる(1万件でも実用速度で取得できるように)。
 */
export class AppDatabase extends Dexie {
  vehicles!: Table<Vehicle, string>
  fuelRecords!: Table<FuelRecord, string>
  maintenanceRecords!: Table<MaintenanceRecord, string>
  settings!: Table<SettingEntry, string>
  /** 愛車の写真(F-22)。車両と 1:1。一覧取得で画像を読み込まないよう本体と分離している */
  vehiclePhotos!: Table<VehiclePhoto, string>

  constructor(name = 'car-maintenance-db') {
    super(name)

    // v1: 初期スキーマ(2026-07-03)
    this.version(1).stores({
      vehicles: 'id',
      fuelRecords: 'id, vehicleId, [vehicleId+date]',
      maintenanceRecords: 'id, vehicleId, [vehicleId+date], [vehicleId+type]',
      settings: 'key',
    })

    // v2: 愛車の写真(F-22)用テーブルを追加(2026-07-05)
    //   - 追加のみ(既存テーブルの定義は v1 のまま引き継がれる)なので既存データは無変更
    //   - 新規テーブルの作成にデータ変換は不要なため upgrade() は書かない
    //   - Vehicle.photoUpdatedAt は非インデックスのため、スキーマ側の変更は不要
    //     (既存の車両レコードはキー自体が無い = 写真なし として扱われる)
    this.version(2).stores({
      vehiclePhotos: 'vehicleId',
    })
  }
}

/** アプリ全体で共有するシングルトン(テストでは AppDatabase を個別生成する) */
export const db = new AppDatabase()
