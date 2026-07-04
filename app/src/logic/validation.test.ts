import { describe, expect, it } from 'vitest'
import { validateFuelRecord, validateMaintenanceRecord, validateVehicle } from './validation'
import type { FuelRecordForCalc } from './fuelEconomy'

const codes = (result: { issues: { code: string }[] }) => result.issues.map((i) => i.code)

describe('validateFuelRecord(給油入力・画面設計書 §0.2)', () => {
  const validInput = {
    date: '2026-07-03',
    odo: 10500,
    fuelAmount: 25,
    isFullTank: true,
  }

  it('ODO・給油量・日付が揃っていれば保存可(金額は任意 = 未入力でもエラーなし)', () => {
    const result = validateFuelRecord(validInput)
    expect(result.errors).toHaveLength(0)
    expect(result.canSave).toBe(true)
  })

  it('ODO未入力はエラー(保存不可)', () => {
    const result = validateFuelRecord({ ...validInput, odo: null })
    expect(codes(result)).toContain('odo_required')
    expect(result.canSave).toBe(false)
  })

  it('給油量未入力はエラー(保存不可)', () => {
    const result = validateFuelRecord({ ...validInput, fuelAmount: null })
    expect(codes(result)).toContain('fuel_amount_required')
    expect(result.canSave).toBe(false)
  })

  it('金額がマイナスの場合のみ金額エラーになる', () => {
    expect(validateFuelRecord({ ...validInput, totalPrice: null }).canSave).toBe(true)
    expect(validateFuelRecord({ ...validInput, totalPrice: 6000 }).canSave).toBe(true)
    expect(validateFuelRecord({ ...validInput, totalPrice: -100 }).canSave).toBe(false)
  })

  it('ODO逆行は警告(保存はブロックしない)', () => {
    const result = validateFuelRecord(validInput, { previousOdo: 11000 })
    const warning = result.warnings.find((w) => w.code === 'odo_reversal')
    expect(warning).toBeDefined()
    expect(warning?.level).toBe('warning')
    expect(result.canSave).toBe(true) // 要件 §6.1: 警告表示のみで保存可
  })

  it('前回ODO以上なら逆行警告は出ない', () => {
    const result = validateFuelRecord(validInput, { previousOdo: 10500 })
    expect(codes(result)).not.toContain('odo_reversal')
  })

  it('タンク容量超過は警告(保存可)', () => {
    const result = validateFuelRecord(
      { ...validInput, fuelAmount: 45 },
      { tankCapacity: 40 },
    )
    expect(codes(result)).toContain('tank_capacity_exceeded')
    expect(result.canSave).toBe(true)
  })

  it('タンク容量が未設定なら容量警告は出ない', () => {
    const result = validateFuelRecord({ ...validInput, fuelAmount: 45 })
    expect(codes(result)).not.toContain('tank_capacity_exceeded')
  })

  it('算出燃費が1〜60km/L範囲外なら警告(保存可)', () => {
    const existingRecords: FuelRecordForCalc[] = [
      { id: 'a', date: '2026-06-01', odo: 10000, fuelAmount: 40, isFullTank: true },
    ]
    // 0.8 km/L(範囲外・低すぎ)
    const low = validateFuelRecord(
      { ...validInput, odo: 10020, fuelAmount: 25 },
      { existingRecords },
    )
    expect(codes(low)).toContain('economy_out_of_range')
    expect(low.canSave).toBe(true)

    // 100 km/L(範囲外・高すぎ)
    const high = validateFuelRecord(
      { ...validInput, odo: 10500, fuelAmount: 5 },
      { existingRecords },
    )
    expect(codes(high)).toContain('economy_out_of_range')

    // 20 km/L(正常範囲)
    const ok = validateFuelRecord(
      { ...validInput, odo: 10500, fuelAmount: 25 },
      { existingRecords },
    )
    expect(codes(ok)).not.toContain('economy_out_of_range')
  })

  it('過去日付の後追い入力でも実際の時系列位置で燃費範囲を判定する', () => {
    // a(満タン基準)→ [後追い入力] → b(満タン・確定済み)
    const existingRecords: FuelRecordForCalc[] = [
      { id: 'a', date: '2026-06-01', odo: 10000, fuelAmount: 40, isFullTank: true },
      { id: 'b', date: '2026-06-20', odo: 10500, fuelAmount: 25, isFullTank: true },
    ]
    // 06-10 の後追い入力: 区間は a→入力(300km ÷ 4L = 75 km/L)→ 範囲外警告が出るべき
    // (旧実装は入力を時系列最後として扱い、b 基準の逆行扱いで警告を出せなかった)
    const result = validateFuelRecord(
      { date: '2026-06-10', odo: 10300, fuelAmount: 4, isFullTank: true },
      { existingRecords },
    )
    expect(codes(result)).toContain('economy_out_of_range')

    // 正常燃費(300km ÷ 15L = 20 km/L)なら警告なし
    const ok = validateFuelRecord(
      { date: '2026-06-10', odo: 10300, fuelAmount: 15, isFullTank: true },
      { existingRecords },
    )
    expect(codes(ok)).not.toContain('economy_out_of_range')
  })

  it('初回給油(既存記録なし)では燃費範囲警告は出ない(計算不能のため)', () => {
    const result = validateFuelRecord(validInput, { existingRecords: [] })
    expect(codes(result)).not.toContain('economy_out_of_range')
  })

  it('給油日未入力はエラー(保存不可)', () => {
    const result = validateFuelRecord({ ...validInput, date: null })
    expect(codes(result)).toContain('date_required')
    expect(result.canSave).toBe(false)
  })

  it('給油量0・マイナスはエラー(保存不可)', () => {
    expect(codes(validateFuelRecord({ ...validInput, fuelAmount: 0 }))).toContain('invalid_number')
    expect(validateFuelRecord({ ...validInput, fuelAmount: 0 }).canSave).toBe(false)
    expect(validateFuelRecord({ ...validInput, fuelAmount: -5 }).canSave).toBe(false)
  })

  it('ODOマイナスはエラー、ODO=0は許容', () => {
    expect(validateFuelRecord({ ...validInput, odo: -1 }).canSave).toBe(false)
    expect(validateFuelRecord({ ...validInput, odo: 0 }).canSave).toBe(true)
  })

  it('燃費境界値: ちょうど1km/L・60km/Lは警告なし、範囲外(0.5・61)は警告', () => {
    const existingRecords: FuelRecordForCalc[] = [
      { id: 'a', date: '2026-06-01', odo: 10000, fuelAmount: 40, isFullTank: true },
    ]
    const check = (odo: number, fuelAmount: number) =>
      codes(validateFuelRecord({ ...validInput, odo, fuelAmount }, { existingRecords }))

    expect(check(10001, 1)).not.toContain('economy_out_of_range') // ちょうど 1 km/L
    expect(check(10060, 1)).not.toContain('economy_out_of_range') // ちょうど 60 km/L
    expect(check(10001, 2)).toContain('economy_out_of_range') // 0.5 km/L(下限外)
    expect(check(10061, 1)).toContain('economy_out_of_range') // 61 km/L(上限外)
  })

  it('タンク容量境界値: ちょうど容量までは警告なし、超えたら警告', () => {
    expect(
      codes(validateFuelRecord({ ...validInput, fuelAmount: 40 }, { tankCapacity: 40 })),
    ).not.toContain('tank_capacity_exceeded')
    expect(
      codes(validateFuelRecord({ ...validInput, fuelAmount: 40.01 }, { tankCapacity: 40 })),
    ).toContain('tank_capacity_exceeded')
  })

  it('ODO同値(前回ODOと同じ)は逆行警告を出さない', () => {
    const result = validateFuelRecord({ ...validInput, odo: 10500 }, { previousOdo: 10500 })
    expect(codes(result)).not.toContain('odo_reversal')
  })

  it('部分給油(満タンOFF)では燃費範囲警告は出ない(燃費未確定のため)', () => {
    const existingRecords: FuelRecordForCalc[] = [
      { id: 'a', date: '2026-06-01', odo: 10000, fuelAmount: 40, isFullTank: true },
    ]
    const result = validateFuelRecord(
      { ...validInput, odo: 10020, fuelAmount: 25, isFullTank: false },
      { existingRecords },
    )
    expect(codes(result)).not.toContain('economy_out_of_range')
  })

  it('エラーと警告が同時に発生し得る(未入力エラー + 容量超過警告)', () => {
    const result = validateFuelRecord(
      { date: '2026-07-03', odo: null, fuelAmount: 45, isFullTank: true },
      { tankCapacity: 40 },
    )
    expect(result.errors.length).toBeGreaterThan(0)
    expect(codes(result)).toContain('tank_capacity_exceeded')
    expect(result.canSave).toBe(false)
  })
})

describe('validateVehicle(車両フォーム・S-08)', () => {
  const validInput = { name: 'ノート', initialOdo: 10000 }

  it('車両名・登録時ODOが揃っていれば保存可(他は任意)', () => {
    expect(validateVehicle(validInput).canSave).toBe(true)
  })

  it('車両名未入力・空白のみはエラー', () => {
    expect(codes(validateVehicle({ ...validInput, name: null }))).toContain('name_required')
    expect(codes(validateVehicle({ ...validInput, name: '' }))).toContain('name_required')
    expect(codes(validateVehicle({ ...validInput, name: '   ' }))).toContain('name_required')
    expect(validateVehicle({ ...validInput, name: '' }).canSave).toBe(false)
  })

  it('登録時ODO未入力はエラー、マイナスはエラー、0は許容', () => {
    expect(codes(validateVehicle({ ...validInput, initialOdo: null }))).toContain('odo_required')
    expect(validateVehicle({ ...validInput, initialOdo: -1 }).canSave).toBe(false)
    expect(validateVehicle({ ...validInput, initialOdo: 0 }).canSave).toBe(true)
  })

  it('タンク容量は未入力OK・0以下はエラー', () => {
    expect(validateVehicle({ ...validInput, tankCapacity: null }).canSave).toBe(true)
    expect(validateVehicle({ ...validInput, tankCapacity: 41 }).canSave).toBe(true)
    const zero = validateVehicle({ ...validInput, tankCapacity: 0 })
    expect(codes(zero)).toContain('invalid_number')
    expect(zero.canSave).toBe(false)
    expect(validateVehicle({ ...validInput, tankCapacity: -5 }).canSave).toBe(false)
  })
})

describe('validateMaintenanceRecord(メンテ入力・S-05)', () => {
  const validInput = { type: 'oil_change', date: '2026-07-03', odo: 10500 }

  it('種別・日付・ODOが揃っていれば保存可(費用は任意)', () => {
    expect(validateMaintenanceRecord(validInput).canSave).toBe(true)
  })

  it('種別未選択はエラー', () => {
    const result = validateMaintenanceRecord({ ...validInput, type: null })
    expect(codes(result)).toContain('maintenance_type_required')
    expect(result.canSave).toBe(false)
  })

  it('ODO未入力はエラー', () => {
    const result = validateMaintenanceRecord({ ...validInput, odo: null })
    expect(codes(result)).toContain('odo_required')
    expect(result.canSave).toBe(false)
  })

  it('費用は0円可・マイナスはエラー', () => {
    expect(validateMaintenanceRecord({ ...validInput, cost: 0 }).canSave).toBe(true)
    expect(validateMaintenanceRecord({ ...validInput, cost: -1 }).canSave).toBe(false)
  })

  it('ODO逆行は警告(保存可)', () => {
    const result = validateMaintenanceRecord(validInput, { previousOdo: 11000 })
    expect(codes(result)).toContain('odo_reversal')
    expect(result.canSave).toBe(true)
  })
})
