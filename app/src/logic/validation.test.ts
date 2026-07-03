import { describe, expect, it } from 'vitest'
import { validateFuelRecord, validateMaintenanceRecord } from './validation'
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

  it('初回給油(既存記録なし)では燃費範囲警告は出ない(計算不能のため)', () => {
    const result = validateFuelRecord(validInput, { existingRecords: [] })
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
