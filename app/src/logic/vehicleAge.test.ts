import { describe, expect, it } from 'vitest'
import { elapsedYearsMonths } from './vehicleAge'

/** テスト基準日: 2026-07-05(日にちは結果に影響しない想定) */
const TODAY = new Date(2026, 6, 5)

describe('elapsedYearsMonths(初度登録からの経過年月)', () => {
  it('年と月の両方があるとき「◯年◯ヶ月」', () => {
    expect(elapsedYearsMonths('2021-04', TODAY)).toBe('5年3ヶ月')
    expect(elapsedYearsMonths('2025-06', TODAY)).toBe('1年1ヶ月')
  })

  it('1年未満は「◯ヶ月」', () => {
    expect(elapsedYearsMonths('2026-01', TODAY)).toBe('6ヶ月')
    expect(elapsedYearsMonths('2025-08', TODAY)).toBe('11ヶ月')
  })

  it('ちょうど◯年は「◯年」(0ヶ月を付けない)', () => {
    expect(elapsedYearsMonths('2021-07', TODAY)).toBe('5年')
    expect(elapsedYearsMonths('2025-07', TODAY)).toBe('1年')
  })

  it('当月は「0ヶ月」', () => {
    expect(elapsedYearsMonths('2026-07', TODAY)).toBe('0ヶ月')
  })

  it('日にちは考慮しない(月初でも月末でも同じ結果)', () => {
    expect(elapsedYearsMonths('2026-06', new Date(2026, 6, 1))).toBe('1ヶ月')
    expect(elapsedYearsMonths('2026-06', new Date(2026, 6, 31))).toBe('1ヶ月')
  })

  it('未来の年月は null(非表示扱い)', () => {
    expect(elapsedYearsMonths('2026-08', TODAY)).toBeNull()
    expect(elapsedYearsMonths('2030-01', TODAY)).toBeNull()
  })

  it("不正な文字列は null('YYYY-MM' 以外・存在しない月)", () => {
    expect(elapsedYearsMonths('', TODAY)).toBeNull()
    expect(elapsedYearsMonths('abc', TODAY)).toBeNull()
    expect(elapsedYearsMonths('2020', TODAY)).toBeNull()
    expect(elapsedYearsMonths('2020-4', TODAY)).toBeNull() // ゼロ埋めなし
    expect(elapsedYearsMonths('2020-04-01', TODAY)).toBeNull() // 日付形式
    expect(elapsedYearsMonths('2020-00', TODAY)).toBeNull()
    expect(elapsedYearsMonths('2020-13', TODAY)).toBeNull()
  })
})
