import { describe, expect, it } from 'vitest'
import {
  calculateFuelEconomies,
  calculateFuelStats,
  calculateMonthlyFuelCost,
  calculateStatsFromIntervals,
  computeTotalPrice,
  computeUnitPrice,
  diffFuelEconomies,
  findPreviousRecord,
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

  describe('date 指定(過去日付の後追い入力)', () => {
    // a(基準・満タン)→ [後追い入力位置] → b(満タン・確定済み)
    const withLater = [
      rec('a', '2026-06-01', 10000, 40),
      rec('b', '2026-06-20', 10500, 25), // 確定済み: 500/25 = 20
    ]

    it('date を渡すと実際の時系列位置に挿入して計算する(直前の満タンが基準)', () => {
      const preview = previewFuelEconomy(withLater, {
        date: '2026-06-10',
        odo: 10300,
        fuelAmount: 15,
        isFullTank: true,
      })
      // 基準は a(10000)。最新の b(10500)ではない
      expect(preview).toEqual({ economy: 20, distance: 300 }) // 300 ÷ 15
    })

    it('date 未指定なら従来どおり時系列の最後として扱う(後方互換)', () => {
      // 最新 b(10500)が基準になり、10300 は逆行 → プレビューなし
      expect(
        previewFuelEconomy(withLater, { odo: 10300, fuelAmount: 15, isFullTank: true }),
      ).toBeNull()
    })

    it('全記録より未来の date は時系列の最後と同じ結果になる', () => {
      const preview = previewFuelEconomy(withLater, {
        date: '2026-07-01',
        odo: 10800,
        fuelAmount: 15,
        isFullTank: true,
      })
      expect(preview).toEqual({ economy: 20, distance: 300 }) // (10800-10500) ÷ 15
    })

    it('挿入位置で逆行になる場合はプレビューしない', () => {
      expect(
        previewFuelEconomy(withLater, {
          date: '2026-06-10',
          odo: 9500, // 直前の a(10000)より小さい
          fuelAmount: 15,
          isFullTank: true,
        }),
      ).toBeNull()
    })
  })
})

describe('findPreviousRecord(入力日付の直前の記録 — ODO逆行警告の基準)', () => {
  const records = [
    rec('a', '2026-06-01', 10000, 40),
    rec('b', '2026-06-10', 10300, 10, false),
    rec('c', '2026-06-20', 10600, 20),
  ]

  it('入力日付より前の最後の記録を返す(後追い入力では最新記録ではない)', () => {
    expect(findPreviousRecord(records, '2026-06-15')?.id).toBe('b')
    expect(findPreviousRecord(records, '2026-06-05')?.id).toBe('a')
  })

  it('全記録より後の日付なら最新の記録を返す', () => {
    expect(findPreviousRecord(records, '2026-07-01')?.id).toBe('c')
  })

  it('同日の記録は直前候補に含める', () => {
    expect(findPreviousRecord(records, '2026-06-10')?.id).toBe('b')
  })

  it('全記録より前の日付・記録なしは undefined(initialOdo 基準は呼び出し側)', () => {
    expect(findPreviousRecord(records, '2026-05-01')).toBeUndefined()
    expect(findPreviousRecord([], '2026-06-15')).toBeUndefined()
  })

  it('入力順に依存しない(時系列ソートして判定する)', () => {
    const shuffled = [records[2], records[0], records[1]]
    expect(findPreviousRecord(shuffled, '2026-06-15')?.id).toBe('b')
  })
})

describe('findPreviousRecord(anchor 指定 — 同日複数給油の誤警告対策)', () => {
  /** createdAt つきの記録(同日・同ODO時の順序決定テスト用) */
  const recAt = (
    id: string,
    date: string,
    odo: number,
    createdAt: string,
  ): FuelRecordForCalc => ({ ...rec(id, date, odo, 20), createdAt })

  // 実使用で報告されたケース: 10/25 に2回給油(ODO 2301 → 2644)、前日以前に 1974
  const prev = recAt('prev', '2026-10-20', 1974, '2026-10-20T09:00:00.000Z')
  const first = recAt('first', '2026-10-25', 2301, '2026-10-25T08:00:00.000Z')
  const second = recAt('second', '2026-10-25', 2644, '2026-10-25T19:00:00.000Z')
  const all = [prev, first, second]
  /** S-04 編集画面と同じく「自分を除く記録」を作る */
  const others = (self: FuelRecordForCalc) => all.filter((r) => r.id !== self.id)

  it('同日2件の1件目を anchor にすると前日以前の記録を返す(同日の後の記録を前回扱いしない)', () => {
    const found = findPreviousRecord(others(first), first.date, {
      odo: first.odo,
      createdAt: first.createdAt,
      id: first.id,
    })
    expect(found?.id).toBe('prev')
    expect(found?.odo).toBe(1974) // 2301 > 1974 なので逆行警告は出ない
  })

  it('同日2件の2件目を anchor にすると同日1件目を返す', () => {
    const found = findPreviousRecord(others(second), second.date, {
      odo: second.odo,
      createdAt: second.createdAt,
      id: second.id,
    })
    expect(found?.id).toBe('first')
    expect(found?.odo).toBe(2301) // 2644 > 2301 なので逆行警告は出ない
  })

  it('anchor の記録自身が records に含まれていても「厳密に前」で除外される', () => {
    expect(
      findPreviousRecord(all, first.date, {
        odo: first.odo,
        createdAt: first.createdAt,
        id: first.id,
      })?.id,
    ).toBe('prev')
  })

  it('anchor 省略時は従来どおり「その日付までの最後の記録」を返す(後方互換)', () => {
    expect(findPreviousRecord(others(first), first.date)?.id).toBe('second')
    expect(findPreviousRecord(all, '2026-10-25')?.id).toBe('second')
    expect(findPreviousRecord(all, '2026-10-21')?.id).toBe('prev')
  })

  it('anchor の odo が未指定/NaN のときも従来どおり(S-02 でODO未入力なら最新をヒント表示)', () => {
    expect(findPreviousRecord(all, '2026-10-25', { odo: null })?.id).toBe('second')
    expect(findPreviousRecord(all, '2026-10-25', {})?.id).toBe('second')
    expect(findPreviousRecord(all, '2026-10-25', { odo: Number.NaN })?.id).toBe('second')
    expect(findPreviousRecord(all, '2026-10-25', null)?.id).toBe('second')
    // ODO未入力でも日付の絞り込みは効く
    expect(findPreviousRecord(all, '2026-10-21', { odo: null })?.id).toBe('prev')
  })

  it('S-02 新規入力: 同日の途中のODOを入力中でも直前(ODOが小さい側)を返す', () => {
    expect(findPreviousRecord(all, '2026-10-25', { odo: 2500 })?.id).toBe('first')
    expect(findPreviousRecord(all, '2026-10-25', { odo: 2700 })?.id).toBe('second')
    // 同日の最小ODOより小さい入力なら前日以前の記録が基準
    expect(findPreviousRecord(all, '2026-10-25', { odo: 2000 })?.id).toBe('prev')
  })

  it('同日3件以上でも各記録の直前を返す', () => {
    const third = recAt('third', '2026-10-25', 2900, '2026-10-25T22:00:00.000Z')
    const four = [prev, first, second, third]
    const anchorOf = (r: FuelRecordForCalc) => ({ odo: r.odo, createdAt: r.createdAt, id: r.id })
    expect(findPreviousRecord(four, first.date, anchorOf(first))?.id).toBe('prev')
    expect(findPreviousRecord(four, second.date, anchorOf(second))?.id).toBe('first')
    expect(findPreviousRecord(four, third.date, anchorOf(third))?.id).toBe('second')
  })

  it('同日・同ODO は createdAt の順で直前が決まる', () => {
    const dupEarly = recAt('dup-early', '2026-10-25', 2301, '2026-10-25T08:00:00.000Z')
    const dupLate = recAt('dup-late', '2026-10-25', 2301, '2026-10-25T12:00:00.000Z')
    const records = [prev, dupEarly, dupLate]
    expect(
      findPreviousRecord(records, dupLate.date, {
        odo: dupLate.odo,
        createdAt: dupLate.createdAt,
        id: dupLate.id,
      })?.id,
    ).toBe('dup-early')
    expect(
      findPreviousRecord(records, dupEarly.date, {
        odo: dupEarly.odo,
        createdAt: dupEarly.createdAt,
        id: dupEarly.id,
      })?.id,
    ).toBe('prev')
  })

  it('同日・同ODO・同createdAt は id の順で直前が決まる', () => {
    const sameA = recAt('aaa', '2026-10-25', 2301, '2026-10-25T08:00:00.000Z')
    const sameB = recAt('bbb', '2026-10-25', 2301, '2026-10-25T08:00:00.000Z')
    const records = [prev, sameA, sameB]
    expect(
      findPreviousRecord(records, '2026-10-25', {
        odo: 2301,
        createdAt: sameB.createdAt,
        id: sameB.id,
      })?.id,
    ).toBe('aaa')
    expect(
      findPreviousRecord(records, '2026-10-25', {
        odo: 2301,
        createdAt: sameA.createdAt,
        id: sameA.id,
      })?.id,
    ).toBe('prev')
  })

  it('日付をまたぐ本当の逆行では前日以前の記録が基準になる(警告は従来どおり出る)', () => {
    // 翌日に ODO 2000(前日の 2644 より小さい)を入力 → 基準は 2644 のまま = 逆行警告あり
    const found = findPreviousRecord(all, '2026-10-26', { odo: 2000 })
    expect(found?.id).toBe('second')
    expect(found?.odo).toBe(2644)
    expect(2000 < (found?.odo ?? 0)).toBe(true)
  })

  it('同日の記録しか無い場合は undefined(initialOdo 基準は呼び出し側)', () => {
    expect(
      findPreviousRecord([second], first.date, {
        odo: first.odo,
        createdAt: first.createdAt,
        id: first.id,
      }),
    ).toBeUndefined()
    expect(findPreviousRecord([], '2026-10-25', { odo: 2301 })).toBeUndefined()
  })

  it('同日2件の燃費計算・走行距離は anchor 導入前と変わらない(計算は ODO 昇順)', () => {
    // 1974(満タン) → 2301(満タン, 15.51L) → 2644
    const records = [
      rec('prev', '2026-10-20', 1974, 30),
      rec('first', '2026-10-25', 2301, 15.51),
      rec('second', '2026-10-25', 2644, 20),
    ]
    const { perRecord, intervals } = calculateFuelEconomies(records)
    expect(perRecord.get('first')).toBe(21.08) // 327km ÷ 15.51L
    expect(intervals[0]).toMatchObject({ endRecordId: 'first', startOdo: 1974, distance: 327 })
    expect(intervals[1]).toMatchObject({ endRecordId: 'second', startOdo: 2301, distance: 343 })
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

describe('calculateStatsFromIntervals(確定区間からの統計 — S-07 期間フィルタ用)', () => {
  const allRecords = [
    rec('a', '2026-01-01', 10000, 40),
    rec('b', '2026-02-01', 10500, 25), // 500/25 = 20 km/L
    rec('c', '2026-05-01', 10800, 30), // 300/30 = 10 km/L
    rec('d', '2026-06-01', 11200, 25), // 400/25 = 16 km/L
  ]

  it('期間フィルタ後の部分区間でも「総距離 ÷ 総給油量」で平均を計算する', () => {
    const { intervals } = calculateFuelEconomies(allRecords)
    // 直近2区間のみ(S-07 の期間切替を想定)
    const filtered = intervals.filter((iv) => ['c', 'd'].includes(iv.endRecordId))
    const stats = calculateStatsFromIntervals(filtered)
    expect(stats.averageEconomy).toBe(12.73) // (300+400) ÷ (30+25) = 700/55
    expect(stats.best?.endRecordId).toBe('d')
    expect(stats.worst?.endRecordId).toBe('c')
    expect(stats.intervalCount).toBe(2)
  })

  it('calculateFuelStats(全記録)と全区間指定で同じ結果になる', () => {
    const { intervals } = calculateFuelEconomies(allRecords)
    expect(calculateStatsFromIntervals(intervals)).toEqual(calculateFuelStats(allRecords))
  })

  it('区間0件ならすべて null / 0', () => {
    expect(calculateStatsFromIntervals([])).toEqual({
      averageEconomy: null,
      best: null,
      worst: null,
      intervalCount: 0,
    })
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
