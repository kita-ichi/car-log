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
import { CSV_BOM, type BackupFile } from '../logic/export'

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
    expect(parsed.schemaVersion).toBe(1)
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
