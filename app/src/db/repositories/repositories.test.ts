/**
 * リポジトリ層の結合テスト(fake-indexeddb 上で Dexie を実行)
 * - CRUD・アーカイブ・燃費キャッシュの再計算(追加・編集・削除)を検証する
 */
import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { AppDatabase } from '../database'
import { createVehicleRepository } from './vehicleRepository'
import { createFuelRecordRepository } from './fuelRecordRepository'
import { createMaintenanceRepository } from './maintenanceRepository'
import { createSettingsRepository } from './settingsRepository'

/** テストごとに独立したDBとリポジトリ一式を作る */
function setup() {
  const database = new AppDatabase(`test-db-${crypto.randomUUID()}`)
  return {
    database,
    vehicles: createVehicleRepository(database),
    fuelRecords: createFuelRecordRepository(database),
    maintenance: createMaintenanceRepository(database),
    settings: createSettingsRepository(database),
  }
}

describe('vehicleRepository', () => {
  it('登録時に既定値(car / regular / isArchived=false)とタイムスタンプが付与される', async () => {
    const { vehicles } = setup()
    const vehicle = await vehicles.create({ name: 'ノート', initialOdo: 10000 })
    expect(vehicle.id).toBeTruthy()
    expect(vehicle.vehicleType).toBe('car')
    expect(vehicle.fuelType).toBe('regular')
    expect(vehicle.isArchived).toBe(false)
    expect(vehicle.createdAt).toBeTruthy()
    expect(await vehicles.getById(vehicle.id)).toEqual(vehicle)
  })

  it('バイクも登録できる(vehicleType: motorcycle)', async () => {
    const { vehicles } = setup()
    const bike = await vehicles.create({
      name: 'MT-07',
      initialOdo: 18000,
      vehicleType: 'motorcycle',
      tankCapacity: 14,
    })
    expect(bike.vehicleType).toBe('motorcycle')
    expect(bike.tankCapacity).toBe(14)
  })

  it('更新で updatedAt が変わり、指定フィールドだけ更新される', async () => {
    const { vehicles } = setup()
    const vehicle = await vehicles.create({ name: 'ノート', initialOdo: 10000 })
    const updated = await vehicles.update(vehicle.id, { name: 'ノート e-POWER' })
    expect(updated.name).toBe('ノート e-POWER')
    expect(updated.initialOdo).toBe(10000)
    expect(updated.createdAt).toBe(vehicle.createdAt)
  })

  it('存在しない車両の更新はエラー', async () => {
    const { vehicles } = setup()
    await expect(vehicles.update('missing', { name: 'x' })).rejects.toThrow()
  })

  it('アーカイブで listActive から消えるが、データと記録は保持される', async () => {
    const { vehicles, fuelRecords } = setup()
    const car = await vehicles.create({ name: 'ノート', initialOdo: 10000 })
    const bike = await vehicles.create({ name: 'MT-07', initialOdo: 18000 })
    await fuelRecords.create({
      vehicleId: car.id,
      date: '2026-07-01',
      odo: 10100,
      fuelAmount: 30,
    })

    await vehicles.archive(car.id)

    const active = await vehicles.listActive()
    expect(active.map((v) => v.id)).toEqual([bike.id])
    // データ本体と記録は消えない
    expect((await vehicles.getById(car.id))?.isArchived).toBe(true)
    expect(await fuelRecords.listByVehicle(car.id)).toHaveLength(1)
    expect((await vehicles.listAll()).length).toBe(2)

    // 復元も可能
    await vehicles.unarchive(car.id)
    expect((await vehicles.listActive()).length).toBe(2)
  })
})

describe('fuelRecordRepository', () => {
  it('総額入力時は単価が自動算出されて保存される', async () => {
    const { fuelRecords } = setup()
    const record = await fuelRecords.create({
      vehicleId: 'v1',
      date: '2026-07-01',
      odo: 10000,
      fuelAmount: 40,
      totalPrice: 6000,
    })
    expect(record.totalPrice).toBe(6000)
    expect(record.unitPrice).toBe(150)
    expect(record.isFullTank).toBe(true) // 既定値
  })

  it('単価側から入力した場合は総額が逆算される', async () => {
    const { fuelRecords } = setup()
    const record = await fuelRecords.create({
      vehicleId: 'v1',
      date: '2026-07-01',
      odo: 10000,
      fuelAmount: 40,
      unitPrice: 150,
    })
    expect(record.totalPrice).toBe(6000)
    expect(record.unitPrice).toBe(150)
  })

  it('金額未入力なら totalPrice / unitPrice とも null(燃費は計算される)', async () => {
    const { fuelRecords } = setup()
    await fuelRecords.create({
      vehicleId: 'v1',
      date: '2026-07-01',
      odo: 10000,
      fuelAmount: 40,
    })
    const second = await fuelRecords.create({
      vehicleId: 'v1',
      date: '2026-07-15',
      odo: 10500,
      fuelAmount: 25,
    })
    expect(second.totalPrice).toBeNull()
    expect(second.unitPrice).toBeNull()
    expect(second.fuelEconomy).toBe(20) // 金額なしでも燃費は確定する
  })

  it('追加のたびに燃費キャッシュが再計算される(部分給油の積算を含む)', async () => {
    const { fuelRecords } = setup()
    const first = await fuelRecords.create({
      vehicleId: 'v1',
      date: '2026-06-01',
      odo: 10000,
      fuelAmount: 40,
    })
    expect(first.fuelEconomy).toBeNull() // 初回は基準なし

    const partial = await fuelRecords.create({
      vehicleId: 'v1',
      date: '2026-06-10',
      odo: 10300,
      fuelAmount: 10,
      isFullTank: false,
    })
    expect(partial.fuelEconomy).toBeNull() // 計算待ち

    const full = await fuelRecords.create({
      vehicleId: 'v1',
      date: '2026-06-20',
      odo: 10600,
      fuelAmount: 20,
    })
    expect(full.fuelEconomy).toBe(20) // 600 ÷ (10+20)
  })

  it('中間記録の編集で影響区間の燃費が再計算される', async () => {
    const { fuelRecords } = setup()
    await fuelRecords.create({ vehicleId: 'v1', date: '2026-06-01', odo: 10000, fuelAmount: 40 })
    const partial = await fuelRecords.create({
      vehicleId: 'v1',
      date: '2026-06-10',
      odo: 10300,
      fuelAmount: 10,
      isFullTank: false,
    })
    const full = await fuelRecords.create({
      vehicleId: 'v1',
      date: '2026-06-20',
      odo: 10600,
      fuelAmount: 20,
    })
    expect(full.fuelEconomy).toBe(20)

    // 部分給油の量を 10L → 20L に修正 → 満タン記録の燃費が変わる
    await fuelRecords.update(partial.id, { fuelAmount: 20 })
    const updatedFull = await fuelRecords.getById(full.id)
    expect(updatedFull?.fuelEconomy).toBe(15) // 600 ÷ (20+20)
  })

  it('記録の削除で前後区間の燃費が再計算される', async () => {
    const { fuelRecords } = setup()
    await fuelRecords.create({ vehicleId: 'v1', date: '2026-06-01', odo: 10000, fuelAmount: 40 })
    const middle = await fuelRecords.create({
      vehicleId: 'v1',
      date: '2026-06-10',
      odo: 10400,
      fuelAmount: 20,
    })
    const last = await fuelRecords.create({
      vehicleId: 'v1',
      date: '2026-06-20',
      odo: 10800,
      fuelAmount: 20,
    })
    expect((await fuelRecords.getById(last.id))?.fuelEconomy).toBe(20)

    await fuelRecords.remove(middle.id)
    // 区間が統合され 800km ÷ 20L = 40 km/L
    expect((await fuelRecords.getById(last.id))?.fuelEconomy).toBe(40)
    expect(await fuelRecords.getById(middle.id)).toBeUndefined()
  })

  it('満タンフラグの変更でも再計算される', async () => {
    const { fuelRecords } = setup()
    await fuelRecords.create({ vehicleId: 'v1', date: '2026-06-01', odo: 10000, fuelAmount: 40 })
    const middle = await fuelRecords.create({
      vehicleId: 'v1',
      date: '2026-06-10',
      odo: 10400,
      fuelAmount: 20,
    })
    const last = await fuelRecords.create({
      vehicleId: 'v1',
      date: '2026-06-20',
      odo: 10800,
      fuelAmount: 20,
    })

    await fuelRecords.update(middle.id, { isFullTank: false })
    expect((await fuelRecords.getById(middle.id))?.fuelEconomy).toBeNull()
    // last: (10800-10000) ÷ (20+20) = 20
    expect((await fuelRecords.getById(last.id))?.fuelEconomy).toBe(20)
  })

  it('金額の編集: 総額変更で単価再計算、金額クリアで両方 null', async () => {
    const { fuelRecords } = setup()
    const record = await fuelRecords.create({
      vehicleId: 'v1',
      date: '2026-07-01',
      odo: 10000,
      fuelAmount: 40,
      totalPrice: 6000,
    })

    const changed = await fuelRecords.update(record.id, { totalPrice: 6400 })
    expect(changed.unitPrice).toBe(160)

    const cleared = await fuelRecords.update(record.id, { totalPrice: null })
    expect(cleared.totalPrice).toBeNull()
    expect(cleared.unitPrice).toBeNull()
  })

  it('単価側の編集で総額が逆算される', async () => {
    const { fuelRecords } = setup()
    const record = await fuelRecords.create({
      vehicleId: 'v1',
      date: '2026-07-01',
      odo: 10000,
      fuelAmount: 40,
      totalPrice: 6000,
    })
    const changed = await fuelRecords.update(record.id, { unitPrice: 155 })
    expect(changed.totalPrice).toBe(6200)
    expect(changed.unitPrice).toBe(155)
  })

  it('一覧は日付降順(既定)・昇順も選択可。車両ごとに分離される', async () => {
    const { fuelRecords } = setup()
    await fuelRecords.create({ vehicleId: 'v1', date: '2026-06-01', odo: 10000, fuelAmount: 40 })
    await fuelRecords.create({ vehicleId: 'v1', date: '2026-06-20', odo: 10600, fuelAmount: 20 })
    await fuelRecords.create({ vehicleId: 'v2', date: '2026-06-10', odo: 5000, fuelAmount: 10 })

    const desc = await fuelRecords.listByVehicle('v1')
    expect(desc.map((r) => r.date)).toEqual(['2026-06-20', '2026-06-01'])
    const asc = await fuelRecords.listByVehicle('v1', 'asc')
    expect(asc.map((r) => r.date)).toEqual(['2026-06-01', '2026-06-20'])

    const latest = await fuelRecords.latestByVehicle('v1')
    expect(latest?.date).toBe('2026-06-20')
    expect((await fuelRecords.listByVehicle('v2')).length).toBe(1)
  })
})

describe('maintenanceRepository', () => {
  it('CRUD一式と種別フィルタ・最新取得が動作する', async () => {
    const { maintenance } = setup()
    const oil1 = await maintenance.create({
      vehicleId: 'v1',
      type: 'oil_change',
      date: '2026-01-10',
      odo: 8000,
      cost: 5000,
      shopName: 'オートバックス',
    })
    await maintenance.create({
      vehicleId: 'v1',
      type: 'oil_change',
      date: '2026-06-15',
      odo: 10200,
      cost: 5200,
    })
    await maintenance.create({
      vehicleId: 'v1',
      type: 'tire_rotation',
      date: '2026-03-01',
      odo: 9000,
    })

    // 一覧は日付降順
    const all = await maintenance.listByVehicle('v1')
    expect(all.map((r) => r.date)).toEqual(['2026-06-15', '2026-03-01', '2026-01-10'])

    // 種別フィルタ
    const oils = await maintenance.listByVehicle('v1', 'oil_change')
    expect(oils).toHaveLength(2)

    // 「前回オイル交換いつ?」
    const latestOil = await maintenance.latestByType('v1', 'oil_change')
    expect(latestOil?.date).toBe('2026-06-15')

    // 更新・削除
    const updated = await maintenance.update(oil1.id, { cost: 5500 })
    expect(updated.cost).toBe(5500)
    await maintenance.remove(oil1.id)
    expect(await maintenance.getById(oil1.id)).toBeUndefined()
  })

  it('費用は未入力(null)・0円を許容する', async () => {
    const { maintenance } = setup()
    const free = await maintenance.create({
      vehicleId: 'v1',
      type: 'wiper',
      date: '2026-07-01',
      odo: 10500,
    })
    expect(free.cost).toBeNull()
    const zero = await maintenance.create({
      vehicleId: 'v1',
      type: 'wiper',
      date: '2026-07-02',
      odo: 10510,
      cost: 0,
    })
    expect(zero.cost).toBe(0)
  })

  it('type=other は typeLabel を保持する', async () => {
    const { maintenance } = setup()
    const record = await maintenance.create({
      vehicleId: 'v1',
      type: 'other',
      typeLabel: 'ドラレコ取付',
      date: '2026-07-01',
      odo: 10500,
    })
    expect(record.typeLabel).toBe('ドラレコ取付')
  })
})

describe('settingsRepository', () => {
  it('選択中の車両IDを保存・復元・クリアできる', async () => {
    const { settings } = setup()
    expect(await settings.getSelectedVehicleId()).toBeNull() // 初期状態

    await settings.setSelectedVehicleId('v1')
    expect(await settings.getSelectedVehicleId()).toBe('v1')
    expect(await settings.getAppSettings()).toEqual({ selectedVehicleId: 'v1' })

    await settings.setSelectedVehicleId(null)
    expect(await settings.getSelectedVehicleId()).toBeNull()
  })
})
