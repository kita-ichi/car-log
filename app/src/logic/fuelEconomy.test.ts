import { describe, expect, it } from 'vitest'
import {
  calculateFuelEconomies,
  calculateFuelStats,
  calculateMonthlyFuelCost,
  computeTotalPrice,
  computeUnitPrice,
  diffFuelEconomies,
  previewFuelEconomy,
  sortRecordsChronologically,
  type FuelRecordForCalc,
} from './fuelEconomy'

/** テスト用の給油記録ビルダー */
const rec = (
  id: string,
  date: string,
  odo: number,
  fuelAmount: number,
  isFullTank = true,
  totalPrice: number | null = null,
): FuelRecordForCalc => ({ id, date, odo, fuelAmount, isFullTank, totalPrice })

describe('calculateFuelEconomies(満タン法)', () => {
  it('基本の満タン法: 燃費 = (今回満タンODO − 前回満タンODO) ÷ 今回給油量', () => {
    const records = [
      rec('a', '2026-06-01', 10000, 40),
      rec('b', '2026-06-15', 10500, 25),
    ]
    const { perRecord, intervals } = calculateFuelEconomies(records)
    expect(perRecord.get('a')).toBeNull() // 初回は基準が無い
    expect(perRecord.get('b')).toBe(20) // 500km ÷ 25L
    expect(intervals).toHaveLength(1)
    expect(intervals[0]).toMatchObject({
      endRecordId: 'b',
      startOdo: 10000,
      endOdo: 10500,
      distance: 500,
      fuelUsed: 25,
      economy: 20,
    })
  })

  it('初回給油は燃費を計算しない(基準が無い)', () => {
    const { perRecord, intervals } = calculateFuelEconomies([rec('a', '2026-06-01', 10000, 40)])
    expect(perRecord.get('a')).toBeNull()
    expect(intervals).toHaveLength(0)
  })

  it('記録0件でも壊れない', () => {
    const { perRecord, intervals } = calculateFuelEconomies([])
    expect(perRecord.size).toBe(0)
    expect(intervals).toHaveLength(0)
  })

  it('部分給油は「計算待ち」(null)で、次の満タンまで給油量を積算する', () => {
    const records = [
      rec('a', '2026-06-01', 10000, 40),
      rec('b', '2026-06-10', 10300, 10, false), // 部分給油
      rec('c', '2026-06-20', 10600, 20),
    ]
    const { perRecord, intervals } = calculateFuelEconomies(records)
    expect(perRecord.get('b')).toBeNull() // 計算待ち
    expect(perRecord.get('c')).toBe(20) // 600km ÷ (10 + 20)L
    expect(intervals[0].fuelUsed).toBe(30)
    expect(intervals[0].distance).toBe(600)
  })

  it('連続部分給油もすべて積算される', () => {
    const records = [
      rec('a', '2026-06-01', 10000, 40),
      rec('b', '2026-06-05', 10200, 10, false),
      rec('c', '2026-06-10', 10500, 15, false),
      rec('d', '2026-06-20', 10800, 15),
    ]
    const { perRecord, intervals } = calculateFuelEconomies(records)
    expect(perRecord.get('b')).toBeNull()
    expect(perRecord.get('c')).toBeNull()
    expect(perRecord.get('d')).toBe(20) // 800km ÷ (10+15+15)L
    expect(intervals).toHaveLength(1)
  })

  it('満タン給油が1件も無ければ全件「計算待ち」', () => {
    const records = [
      rec('a', '2026-06-01', 10000, 10, false),
      rec('b', '2026-06-10', 10300, 10, false),
    ]
    const { perRecord, intervals } = calculateFuelEconomies(records)
    expect(perRecord.get('a')).toBeNull()
    expect(perRecord.get('b')).toBeNull()
    expect(intervals).toHaveLength(0)
  })

  it('ODO逆行(リセット・入力ミス)区間は燃費を確定せず、新しい基準点として扱う', () => {
    const records = [
      rec('a', '2026-06-01', 10000, 40),
      rec('b', '2026-06-10', 9500, 30), // ODO逆行(メーター交換等)
      rec('c', '2026-06-20', 10000, 25),
    ]
    const { perRecord, intervals } = calculateFuelEconomies(records)
    expect(perRecord.get('b')).toBeNull() // 逆行区間は確定しない
    expect(perRecord.get('c')).toBe(20) // (10000-9500) ÷ 25 — 新基準から再開
    expect(intervals).toHaveLength(1)
  })

  it('同一ODOの満タン給油(走行0km)は燃費を確定しない', () => {
    const records = [
      rec('a', '2026-06-01', 10000, 40),
      rec('b', '2026-06-01', 10000, 1),
    ]
    const { perRecord } = calculateFuelEconomies(records)
    expect(perRecord.get('b')).toBeNull()
  })

  it('金額なし記録でも燃費は通常どおり計算される', () => {
    const records = [
      rec('a', '2026-06-01', 10000, 40, true, null), // 金額なし
      rec('b', '2026-06-15', 10500, 25, true, null), // 金額なし
    ]
    const { perRecord } = calculateFuelEconomies(records)
    expect(perRecord.get('b')).toBe(20)
  })

  it('入力順に関係なく時系列(date→odo)で計算される', () => {
    const records = [
      rec('c', '2026-06-20', 10600, 20),
      rec('a', '2026-06-01', 10000, 40),
      rec('b', '2026-06-10', 10300, 10, false),
    ]
    const { perRecord } = calculateFuelEconomies(records)
    expect(perRecord.get('c')).toBe(20)
  })

  it('燃費は小数2桁に丸められる', () => {
    const records = [
      rec('a', '2026-06-01', 10000, 40),
      rec('b', '2026-06-15', 10500, 30), // 500/30 = 16.666...
    ]
    const { perRecord } = calculateFuelEconomies(records)
    expect(perRecord.get('b')).toBe(16.67)
  })

  it('給油量0の満タン給油は燃費を確定せず、新しい基準点として扱う(0除算しない)', () => {
    const records = [
      rec('a', '2026-06-01', 10000, 40),
      rec('b', '2026-06-10', 10500, 0), // 給油量0(異常データ)
      rec('c', '2026-06-20', 11000, 25),
    ]
    const { perRecord, intervals } = calculateFuelEconomies(records)
    expect(perRecord.get('b')).toBeNull() // 0除算・Infinity にならない
    expect(perRecord.get('c')).toBe(20) // (11000-10500) ÷ 25 — b が新基準
    expect(intervals).toHaveLength(1)
    expect(Number.isFinite(intervals[0].economy)).toBe(true)
  })

  it('同一日時の重複記録(同date・同odoの部分給油)も給油量はすべて積算される', () => {
    const records = [
      rec('a', '2026-06-01', 10000, 40),
      rec('b', '2026-06-10', 10300, 10, false),
      rec('c', '2026-06-10', 10300, 10, false), // 完全に同じ日付・ODOの重複
      rec('d', '2026-06-20', 10600, 10),
    ]
    const { perRecord, intervals } = calculateFuelEconomies(records)
    expect(perRecord.get('b')).toBeNull()
    expect(perRecord.get('c')).toBeNull()
    expect(perRecord.get('d')).toBe(20) // 600 ÷ (10+10+10)
    expect(intervals[0].fuelUsed).toBe(30)
  })

  it('同一date・同一odoの記録は createdAt で安定ソートされる', () => {
    const records: FuelRecordForCalc[] = [
      { id: 'late', date: '2026-06-10', odo: 10300, fuelAmount: 10, isFullTank: false, createdAt: '2026-06-10T12:00:00.000Z' },
      { id: 'early', date: '2026-06-10', odo: 10300, fuelAmount: 10, isFullTank: false, createdAt: '2026-06-10T09:00:00.000Z' },
    ]
    expect(sortRecordsChronologically(records).map((r) => r.id)).toEqual(['early', 'late'])
  })

  it('小数給油量の積算で浮動小数点誤差が蓄積しない', () => {
    // 0.1 + 0.2 問題: 10.1 + 10.2 = 20.299999... にならないこと
    const records = [
      rec('a', '2026-06-01', 10000, 40),
      rec('b', '2026-06-05', 10200, 10.1, false),
      rec('c', '2026-06-10', 10400, 10.2, false),
      rec('d', '2026-06-20', 10609, 10.2), // 合計 30.5L・走行609km → 19.97
    ]
    const { intervals } = calculateFuelEconomies(records)
    expect(intervals[0].fuelUsed).toBe(30.5)
    expect(intervals[0].economy).toBe(19.97)
  })
})

describe('diffFuelEconomies(追加・編集・削除時の再計算)', () => {
  type Cached = FuelRecordForCalc & { fuelEconomy: number | null }
  const cached = (r: FuelRecordForCalc, fuelEconomy: number | null): Cached => ({
    ...r,
    fuelEconomy,
  })

  it('中間の部分給油を編集すると、区間を確定させる満タン記録だけが再計算対象になる', () => {
    // 元: a(基準) → b(部分10L) → c(満タン20L, 燃費20)
    // b の給油量を 10L → 20L に編集 → c の燃費が 600/(20+20) = 15 に変わる
    const records: Cached[] = [
      cached(rec('a', '2026-06-01', 10000, 40), null),
      cached(rec('b', '2026-06-10', 10300, 20, false), null), // 編集後の値
      cached(rec('c', '2026-06-20', 10600, 20), 20), // 編集前のキャッシュ
    ]
    const changes = diffFuelEconomies(records)
    expect(changes).toEqual([{ id: 'c', fuelEconomy: 15 }])
  })

  it('中間の満タン記録を削除すると、次の満タン区間が統合されて再計算される', () => {
    // 元: a(基準) → b(満タン, 燃費20) → c(満タン, 燃費20)
    // b を削除 → c の区間が a〜c に広がり (800km ÷ 20L) = 40 に変わる
    const records: Cached[] = [
      cached(rec('a', '2026-06-01', 10000, 40), null),
      // b は削除済み
      cached(rec('c', '2026-06-20', 10800, 20), 20), // 削除前のキャッシュ
    ]
    const changes = diffFuelEconomies(records)
    expect(changes).toEqual([{ id: 'c', fuelEconomy: 40 }])
  })

  it('新しい満タン記録の追加時は追加分だけが計算される(既存は変化なし)', () => {
    const records: Cached[] = [
      cached(rec('a', '2026-06-01', 10000, 40), null),
      cached(rec('b', '2026-06-15', 10500, 25), 20),
      cached(rec('c', '2026-06-30', 10900, 20), null), // 追加直後(未計算)
    ]
    const changes = diffFuelEconomies(records)
    expect(changes).toEqual([{ id: 'c', fuelEconomy: 20 }])
  })

  it('満タンフラグの変更(満タン→部分)で自身が計算待ちになり、次の満タンが再計算される', () => {
    // b を満タン→部分に変更: b は null に、c は積算し直しで再計算
    const records: Cached[] = [
      cached(rec('a', '2026-06-01', 10000, 40), null),
      cached(rec('b', '2026-06-15', 10500, 25, false), 20), // 変更後: 部分給油
      cached(rec('c', '2026-06-30', 10900, 20), 50), // 旧キャッシュ(400/20=20→変わる)
    ]
    const changes = diffFuelEconomies(records)
    expect(changes).toContainEqual({ id: 'b', fuelEconomy: null })
    // c: (10900-10000) ÷ (25+20) = 900/45 = 20
    expect(changes).toContainEqual({ id: 'c', fuelEconomy: 20 })
    expect(changes).toHaveLength(2)
  })

  it('変化が無ければ空配列を返す(不要な書き込みをしない)', () => {
    const records: Cached[] = [
      cached(rec('a', '2026-06-01', 10000, 40), null),
      cached(rec('b', '2026-06-15', 10500, 25), 20),
    ]
    expect(diffFuelEconomies(records)).toEqual([])
  })
})

describe('previewFuelEconomy(保存前プレビュー)', () => {
  const existing = [
    rec('a', '2026-06-01', 10000, 40),
    rec('b', '2026-06-10', 10300, 10, false),
  ]

  it('満タンON + ODO・給油量入力済みで燃費と走行距離を返す(部分給油も積算)', () => {
    const preview = previewFuelEconomy(existing, { odo: 10600, fuelAmount: 20, isFullTank: true })
    expect(preview).toEqual({ economy: 20, distance: 600 }) // 600 ÷ (10+20)
  })

  it('満タンOFF(部分給油)ならプレビューしない', () => {
    expect(previewFuelEconomy(existing, { odo: 10600, fuelAmount: 20, isFullTank: false })).toBeNull()
  })

  it('既存記録が無い(初回給油)ならプレビューしない', () => {
    expect(previewFuelEconomy([], { odo: 10600, fuelAmount: 20, isFullTank: true })).toBeNull()
  })

  it('入力ODOが前回満タン以下(逆行・同値)ならプレビューしない', () => {
    expect(previewFuelEconomy(existing, { odo: 9500, fuelAmount: 20, isFullTank: true })).toBeNull()
    expect(previewFuelEconomy(existing, { odo: 10000, fuelAmount: 20, isFullTank: true })).toBeNull()
  })

  it('ODO・給油量が0以下ならプレビューしない', () => {
    expect(previewFuelEconomy(existing, { odo: 0, fuelAmount: 20, isFullTank: true })).toBeNull()
    expect(previewFuelEconomy(existing, { odo: 10600, fuelAmount: 0, isFullTank: true })).toBeNull()
  })
})

describe('calculateFuelStats(統計)', () => {
  it('平均燃費は「総走行距離 ÷ 総給油量」であり、区間燃費の単純平均ではない', () => {
    const records = [
      rec('a', '2026-06-01', 10000, 40),
      rec('b', '2026-06-10', 10500, 25), // 500/25 = 20 km/L
      rec('c', '2026-06-20', 10800, 30), // 300/30 = 10 km/L
    ]
    const stats = calculateFuelStats(records)
    // 単純平均なら (20+10)/2 = 15 だが、正しくは 800/55 = 14.55
    expect(stats.averageEconomy).toBe(14.55)
    expect(stats.best?.economy).toBe(20)
    expect(stats.best?.endRecordId).toBe('b')
    expect(stats.worst?.economy).toBe(10)
    expect(stats.worst?.endRecordId).toBe('c')
    expect(stats.intervalCount).toBe(2)
  })

  it('確定区間が無ければすべて null / 0', () => {
    const stats = calculateFuelStats([rec('a', '2026-06-01', 10000, 40)])
    expect(stats).toEqual({ averageEconomy: null, best: null, worst: null, intervalCount: 0 })
  })

  it('記録0件でも壊れない', () => {
    expect(calculateFuelStats([]).averageEconomy).toBeNull()
  })
})

describe('calculateMonthlyFuelCost(今月の燃料費)', () => {
  it('指定月の金額入力済み記録のみ合計し、金額なし記録は対象外件数として返す', () => {
    const records = [
      rec('a', '2026-07-01', 10000, 40, true, 6000),
      rec('b', '2026-07-15', 10500, 25, true, null), // 金額なし → 対象外
      rec('c', '2026-07-20', 10800, 30, true, 4500),
      rec('d', '2026-06-28', 9800, 20, true, 3000), // 先月 → 含めない
    ]
    const result = calculateMonthlyFuelCost(records, 2026, 7)
    expect(result.total).toBe(10500)
    expect(result.includedCount).toBe(2)
    expect(result.excludedCount).toBe(1)
  })

  it('記録0件なら合計0・対象外0', () => {
    expect(calculateMonthlyFuelCost([], 2026, 7)).toEqual({
      total: 0,
      includedCount: 0,
      excludedCount: 0,
    })
  })

  it('金額0円の記録は「入力済み」として集計に含める(対象外にしない)', () => {
    const records = [rec('a', '2026-07-01', 10000, 40, true, 0)]
    const result = calculateMonthlyFuelCost(records, 2026, 7)
    expect(result.total).toBe(0)
    expect(result.includedCount).toBe(1)
    expect(result.excludedCount).toBe(0)
  })
})

describe('computeUnitPrice / computeTotalPrice(単価⇔総額)', () => {
  it('単価 = 総額 ÷ 給油量(小数1桁)', () => {
    expect(computeUnitPrice(6000, 40)).toBe(150)
    expect(computeUnitPrice(5000, 33.3)).toBe(150.2)
  })

  it('給油量が0以下なら計算しない', () => {
    expect(computeUnitPrice(5000, 0)).toBeNull()
  })

  it('総額 = 単価 × 給油量(整数円)', () => {
    expect(computeTotalPrice(150, 40)).toBe(6000)
    expect(computeTotalPrice(150.2, 33.3)).toBe(5002)
  })
})

describe('sortRecordsChronologically', () => {
  it('date → odo の順で安定ソートされる(元配列は変更しない)', () => {
    const records = [
      rec('b', '2026-06-01', 10300, 10),
      rec('c', '2026-06-02', 10500, 10),
      rec('a', '2026-06-01', 10000, 10),
    ]
    const sorted = sortRecordsChronologically(records)
    expect(sorted.map((r) => r.id)).toEqual(['a', 'b', 'c'])
    expect(records.map((r) => r.id)).toEqual(['b', 'c', 'a']) // 非破壊
  })
})
