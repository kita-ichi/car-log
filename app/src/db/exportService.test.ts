/**
 * F-11 エクスポートサービスの結合テスト(fake-indexeddb 上で Dexie を実行)
 * - DBに保存した実データ → JSONバックアップ往復の完全性
 * - アーカイブ済み車両が含まれること
 * - lastBackupAt の記録(JSONのみ。CSVでは更新しない)
 * - CSVに全車両の記録が入ること
 */
import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { AppDatabase } from './database'
import { createVehicleRepository } from './repositories/vehicleRepository'
import { createFuelRecordRepository } from './repositories/fuelRecordRepository'
import { createMaintenanceRepository } from './repositories/maintenanceRepository'
import { createSettingsRepository } from './repositories/settingsRepository'
import { createExportService } from './exportService'
import { CSV_BOM, backupToPhotoBytes, type BackupFile } from '../logic/export'

/** テストごとに独立したDBとサービス一式を作る */
function setup() {
  const database = new AppDatabase(`test-db-${crypto.randomUUID()}`)
  const repos = {
    vehicles: createVehicleRepository(database),
    fuelRecords: createFuelRecordRepository(database),
    maintenance: createMaintenanceRepository(database),
    settings: createSettingsRepository(database),
  }
  return { ...repos, exporter: createExportService(repos) }
}

/** 2台(1台はアーカイブ)+給油2件+メンテ1件の代表データを投入する */
async function seed(s: ReturnType<typeof setup>) {
  const note = await s.vehicles.create({ name: 'ノート', initialOdo: 10000 })
  const bike = await s.vehicles.create({ name: 'MT-07', initialOdo: 18000, vehicleType: 'motorcycle' })
  await s.fuelRecords.create({
    vehicleId: note.id,
    date: '2026-06-20',
    odo: 10000,
    fuelAmount: 30,
    totalPrice: 4800,
    isFullTank: true,
  })
  await s.fuelRecords.create({
    vehicleId: note.id,
    date: '2026-07-01',
    odo: 10400,
    fuelAmount: 32,
    isFullTank: true, // 燃費 400/32 = 12.5 が確定する
  })
  await s.maintenance.create({
    vehicleId: bike.id,
    type: 'oil_change',
    date: '2026-06-25',
    odo: 18100,
    cost: 3500,
  })
  await s.vehicles.archive(bike.id)
  await s.settings.setSelectedVehicleId(note.id)
  return { note, bike }
}

describe('exportService.exportBackupJson', () => {
  it('DBの全データ(アーカイブ済み車両・設定を含む)が往復で完全に復元できる', async () => {
    const s = setup()
    const { note, bike } = await seed(s)

    const payload = await s.exporter.exportBackupJson(new Date('2026-07-04T12:00:00.000Z'))
    expect(payload.filename).toBe('car-log-backup-2026-07-04.json')
    expect(payload.mimeType).toBe('application/json')

    const parsed = JSON.parse(payload.content) as BackupFile
    expect(parsed.schemaVersion).toBe(3) // 3 = 写真の表示調整(F-22b)に対応
    expect(parsed.exportedAt).toBe('2026-07-04T12:00:00.000Z')

    // 車両: アーカイブ済みも含めて2台、DBの実体と完全一致
    const dbVehicles = await s.vehicles.listAll()
    expect(parsed.data.vehicles).toEqual(dbVehicles)
    expect(parsed.data.vehicles.find((v) => v.id === bike.id)?.isArchived).toBe(true)

    // 給油記録: 燃費キャッシュ・正規化済み単価も含めて完全一致
    expect(parsed.data.fuelRecords).toEqual(await s.fuelRecords.listAll())
    expect(parsed.data.fuelRecords[1].fuelEconomy).toBe(12.5)
    expect(parsed.data.fuelRecords[0].unitPrice).toBe(160)

    // メンテ記録・設定
    expect(parsed.data.maintenanceRecords).toEqual(await s.maintenance.listAll())
    expect(parsed.data.settings.selectedVehicleId).toBe(note.id)
  })

  it('JSONバックアップで lastBackupAt が記録される', async () => {
    const s = setup()
    await seed(s)
    expect(await s.settings.getLastBackupAt()).toBeNull()

    await s.exporter.exportBackupJson(new Date('2026-07-04T12:00:00.000Z'))
    expect(await s.settings.getLastBackupAt()).toBe('2026-07-04T12:00:00.000Z')
    expect((await s.settings.getAppSettings()).lastBackupAt).toBe('2026-07-04T12:00:00.000Z')
  })

  it('記録0件・車両0台でもエクスポートできる', async () => {
    const s = setup()
    const payload = await s.exporter.exportBackupJson()
    const parsed = JSON.parse(payload.content) as BackupFile
    expect(parsed.data.vehicles).toEqual([])
    expect(parsed.data.fuelRecords).toEqual([])
    expect(parsed.data.maintenanceRecords).toEqual([])
  })
})

describe('exportService.exportBackupJson: 愛車の写真(F-22)', () => {
  /** 中身が判別できるダミー画像 */
  const makePhoto = (marker: number, size = 128): Blob =>
    new Blob([new Uint8Array([0xff, 0xd8, 0xff, marker, ...new Array<number>(size - 4).fill(marker)])], {
      type: 'image/jpeg',
    })

  it('既定では写真がBase64で含まれ、バイト列が完全に復元できる', async () => {
    const s = setup()
    const { note } = await seed(s)
    const photo = makePhoto(0x11)
    await s.vehicles.setPhoto(note.id, { blob: photo, width: 1280, height: 960 })

    const payload = await s.exporter.exportBackupJson(new Date('2026-07-04T12:00:00.000Z'))
    const parsed = JSON.parse(payload.content) as BackupFile

    expect(parsed.includesPhotos).toBe(true)
    expect(parsed.data.vehiclePhotos).toHaveLength(1)

    const entry = parsed.data.vehiclePhotos![0]
    expect(entry.vehicleId).toBe(note.id)
    expect(entry.mimeType).toBe('image/jpeg')
    expect(entry.byteSize).toBe(photo.size)
    expect(entry.width).toBe(1280)
    expect(entry.height).toBe(960)
    expect(entry.updatedAt).toBe((await s.vehicles.getById(note.id))?.photoUpdatedAt)

    // JSON → バイト列 → 元の画像と一致(完全復元できること)
    expect(backupToPhotoBytes(entry)).toEqual(new Uint8Array(await photo.arrayBuffer()))
  })

  it('includePhotos: false なら写真を含まず、ファイルも小さくなる', async () => {
    const s = setup()
    const { note } = await seed(s)
    await s.vehicles.setPhoto(note.id, makePhoto(0x11, 4096))

    const withPhotos = await s.exporter.exportBackupJson(new Date('2026-07-04T12:00:00.000Z'))
    const without = await s.exporter.exportBackupJson(new Date('2026-07-04T12:00:00.000Z'), {
      includePhotos: false,
    })

    const parsed = JSON.parse(without.content) as BackupFile
    expect(parsed.includesPhotos).toBe(false)
    // キーごと存在しない(= 写真を書き出していない。空配列とは意味が違う)
    expect(parsed.data.vehiclePhotos).toBeUndefined()
    expect('vehiclePhotos' in parsed.data).toBe(false)

    expect(without.content.length).toBeLessThan(withPhotos.content.length)
    // 車両・記録は変わらず入っている
    expect(parsed.data.vehicles).toHaveLength(2)
    expect(parsed.data.fuelRecords).toHaveLength(2)
    // 写真なしでも photoUpdatedAt は残る(復元後に「写真だけ無い」と分かる)
    expect(parsed.data.vehicles.find((v) => v.id === note.id)?.photoUpdatedAt).toBeTruthy()
  })

  it('写真が1枚も無ければ空配列(「含めたが0枚」と「含めていない」を区別する)', async () => {
    const s = setup()
    await seed(s)
    const parsed = JSON.parse((await s.exporter.exportBackupJson()).content) as BackupFile
    expect(parsed.includesPhotos).toBe(true)
    expect(parsed.data.vehiclePhotos).toEqual([])
  })

  it('複数車両の写真がすべて含まれ、車両IDで対応が取れる', async () => {
    const s = setup()
    const { note, bike } = await seed(s)
    await s.vehicles.setPhoto(note.id, makePhoto(0x11))
    await s.vehicles.setPhoto(bike.id, makePhoto(0x22)) // アーカイブ済み車両の写真も対象

    const parsed = JSON.parse((await s.exporter.exportBackupJson()).content) as BackupFile
    const byVehicle = new Map(parsed.data.vehiclePhotos!.map((p) => [p.vehicleId, p]))
    expect(byVehicle.size).toBe(2)
    expect(backupToPhotoBytes(byVehicle.get(note.id)!)[3]).toBe(0x11)
    expect(backupToPhotoBytes(byVehicle.get(bike.id)!)[3]).toBe(0x22)
  })

  /* ---- 表示調整(F-22b) ---- */

  it('写真の表示調整がバックアップに入る(写真と同じファイルで復元できる)', async () => {
    const s = setup()
    const { note } = await seed(s)
    await s.vehicles.setPhoto(note.id, { blob: makePhoto(0x11), width: 1280, height: 960 })
    const adjust = { zoom: 1.5, focusX: 0.2, focusY: 0.8 }
    await s.vehicles.setPhotoAdjust(note.id, adjust)

    const parsed = JSON.parse((await s.exporter.exportBackupJson()).content) as BackupFile
    expect(parsed.data.vehicles.find((v) => v.id === note.id)?.photoAdjust).toEqual(adjust)
  })

  it('includePhotos: false でも調整値は残る(車両側の値なので写真の有無に依らない)', async () => {
    const s = setup()
    const { note } = await seed(s)
    await s.vehicles.setPhoto(note.id, makePhoto(0x11))
    await s.vehicles.setPhotoAdjust(note.id, { zoom: 2, focusX: 0.1, focusY: 0.9 })

    const parsed = JSON.parse(
      (await s.exporter.exportBackupJson(new Date(), { includePhotos: false })).content,
    ) as BackupFile
    expect(parsed.data.vehiclePhotos).toBeUndefined()
    expect(parsed.data.vehicles.find((v) => v.id === note.id)?.photoAdjust).toEqual({
      zoom: 2,
      focusX: 0.1,
      focusY: 0.9,
    })
  })

  it('調整していない車両には photoAdjust キーが入らない', async () => {
    const s = setup()
    const { note } = await seed(s)
    await s.vehicles.setPhoto(note.id, makePhoto(0x11))

    const payload = await s.exporter.exportBackupJson()
    expect(payload.content).not.toContain('photoAdjust')
  })
})

describe('exportService.exportFuelCsv / exportMaintenanceCsv', () => {
  it('給油CSV: BOM付きで全車両の記録が入り、lastBackupAt は更新しない', async () => {
    const s = setup()
    await seed(s)

    const payload = await s.exporter.exportFuelCsv(new Date('2026-07-04T12:00:00.000Z'))
    expect(payload.filename).toBe('car-log-fuel-records-2026-07-04.csv')
    expect(payload.mimeType).toBe('text/csv')
    expect(payload.content.startsWith(CSV_BOM)).toBe(true)

    const lines = payload.content.slice(CSV_BOM.length).split('\r\n')
    expect(lines).toHaveLength(3) // ヘッダ + 給油2件
    expect(lines[1]).toContain('ノート')
    expect(lines[2]).toContain('12.5') // 確定した燃費が出る

    expect(await s.settings.getLastBackupAt()).toBeNull() // CSVは閲覧用
  })

  it('メンテCSV: アーカイブ済み車両の記録も車両名付きで入る', async () => {
    const s = setup()
    await seed(s)

    const payload = await s.exporter.exportMaintenanceCsv(new Date('2026-07-04T12:00:00.000Z'))
    expect(payload.filename).toBe('car-log-maintenance-records-2026-07-04.csv')

    const lines = payload.content.slice(CSV_BOM.length).split('\r\n')
    expect(lines).toHaveLength(2) // ヘッダ + メンテ1件
    expect(lines[1]).toContain('MT-07')
    expect(lines[1]).toContain('オイル交換')
  })
})
