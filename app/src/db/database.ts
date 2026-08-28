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

    // 写真の表示調整(F-22b / Vehicle.photoAdjust)を 2026-08-28 に追加したが、
    // **スキーマのバージョンは上げていない**。理由:
    //   - photoAdjust は非インデックスのフィールドで、stores() の定義が変わらない
    //     (Dexie は宣言したインデックスだけを管理し、値の形は関知しない)。
    //     定義が同じまま version を足しても、空のアップグレードが走るだけで意味が無い
    //   - 既存レコードはキーを持たないままでよい。読み出し側が
    //     `normalizePhotoAdjust()`(logic/photoAdjust.ts)で既定値(cover + center)
    //     として扱うため、**データ変換が不要**(= 既存の写真の見え方は変わらない)
    //   - v2 で Vehicle.photoUpdatedAt を足したときと同じ扱い(上のコメント参照)
    // インデックスが必要になったときは、この下に version(3) を追記すること。
  }
}

/** アプリ全体で共有するシングルトン(テストでは AppDatabase を個別生成する) */
export const db = new AppDatabase()
