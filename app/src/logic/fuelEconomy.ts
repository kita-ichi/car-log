/**
 * 燃費計算ロジック(満タン法)— 純粋関数のみ。UI・DBに依存しない。
 * 参照: docs/要件定義書.md §6.1
 *
 * 満タン法の基本:
 *   燃費(km/L) = (今回満タンODO − 前回満タンODO) ÷ 区間給油量合計(今回分を含む)
 *   - 部分給油(満タンでない給油)は燃費を確定せず、次の満タンまで給油量を積算する
 *   - 前に満タン給油が存在しない記録(初回など)は基準が無いため計算しない
 *   - ODOが逆行している区間(リセット・入力ミス)は燃費を確定せず、
 *     その満タン給油を新しい基準点として扱う
 *
 * 車・バイク共通(車両タイプによる分岐なし)。
 */

/** 計算に必要な最小限の給油記録フィールド(FuelRecord のサブセット) */
export interface FuelRecordForCalc {
  id: string
  /** 'YYYY-MM-DD' */
  date: string
  odo: number
  fuelAmount: number
  isFullTank: boolean
  /** 費用集計に使用(燃費計算には不使用)。未入力は null/undefined */
  totalPrice?: number | null
  /** 同日・同ODO時のソート安定化に使用(任意) */
  createdAt?: string
}

/** 確定した燃費区間(前回満タン → 今回満タン) */
export interface FuelEconomyInterval {
  /** 区間を確定させた満タン給油記録のID */
  endRecordId: string
  /** 前回満タン時ODO(km) */
  startOdo: number
  /** 今回満タン時ODO(km) */
  endOdo: number
  /** 走行距離(km) */
  distance: number
  /** 区間給油量合計(L)= 前回満タン以降の全給油量(今回分を含む) */
  fuelUsed: number
  /** 燃費(km/L)小数2桁 */
  economy: number
}

/** calculateFuelEconomies の結果 */
export interface FuelEconomyResult {
  /** 記録ID → 算出燃費。未確定(部分給油・初回・ODO逆行)は null */
  perRecord: Map<string, number | null>
  /** 確定区間の一覧(時系列昇順) */
  intervals: FuelEconomyInterval[]
}

/** 統計サマリ */
export interface FuelStats {
  /**
   * 平均燃費(km/L)= 確定区間の総走行距離 ÷ 総給油量。
   * ※各区間燃費の単純平均ではない(要件 §6.1)。確定区間が無ければ null
   */
  averageEconomy: number | null
  /** ベスト燃費の区間(確定区間が無ければ null) */
  best: FuelEconomyInterval | null
  /** ワースト燃費の区間(確定区間が無ければ null) */
  worst: FuelEconomyInterval | null
  /** 確定区間数 */
  intervalCount: number
}

/** 月間燃料費の集計結果(金額入力済みの記録のみ合計する — 要件 §5.2) */
export interface MonthlyFuelCost {
  /** 金額入力済み記録の合計(円) */
  total: number
  /** 集計に含めた記録数 */
  includedCount: number
  /** 金額未入力のため集計対象外とした記録数(画面で注記表示に使う) */
  excludedCount: number
}

const round2 = (n: number): number => Math.round(n * 100) / 100

/**
 * 給油記録を時系列にソートする(date → odo → createdAt → id)。
 * 'YYYY-MM-DD' / ISO 8601 は文字列比較で時系列順になる。元配列は変更しない。
 */
export function sortRecordsChronologically<T extends FuelRecordForCalc>(records: readonly T[]): T[] {
  return [...records].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.odo - b.odo ||
      (a.createdAt ?? '').localeCompare(b.createdAt ?? '') ||
      a.id.localeCompare(b.id),
  )
}

/**
 * 車両1台分の全給油記録から、満タン法で各記録の燃費を計算する。
 *
 * 記録の追加・編集・削除・満タンフラグ変更時は、変更後の全記録で本関数を
 * 呼び直せば影響区間(前後の満タン給油の間)が正しく再計算される。
 * 差分だけをDBに書き戻す場合は diffFuelEconomies() を使う。
 */
export function calculateFuelEconomies(records: readonly FuelRecordForCalc[]): FuelEconomyResult {
  const sorted = sortRecordsChronologically(records)
  const perRecord = new Map<string, number | null>()
  const intervals: FuelEconomyInterval[] = []

  /** 前回満タン時ODO(基準点)。まだ満タン給油が無ければ null */
  let baselineOdo: number | null = null
  /** 基準点以降に積算した給油量(L) */
  let accumulatedFuel = 0

  for (const record of sorted) {
    perRecord.set(record.id, null)
    accumulatedFuel = round2(accumulatedFuel + record.fuelAmount)

    if (!record.isFullTank) {
      // 部分給油: 燃費は確定しない(「計算待ち」)。給油量の積算のみ
      continue
    }

    if (baselineOdo !== null) {
      const distance = record.odo - baselineOdo
      if (distance > 0 && accumulatedFuel > 0) {
        const economy = round2(distance / accumulatedFuel)
        perRecord.set(record.id, economy)
        intervals.push({
          endRecordId: record.id,
          startOdo: baselineOdo,
          endOdo: record.odo,
          distance,
          fuelUsed: accumulatedFuel,
          economy,
        })
      }
      // distance <= 0(ODO逆行・リセット)は燃費 null のまま、基準点だけ更新する
    }

    // 満タン給油を新しい基準点にして積算をリセット
    baselineOdo = record.odo
    accumulatedFuel = 0
  }

  return { perRecord, intervals }
}

/**
 * 再計算の結果、キャッシュ済み燃費(fuelEconomy)と異なる記録だけを抽出する。
 * リポジトリ層はこの差分のみ bulkUpdate すればよい。
 */
export function diffFuelEconomies(
  records: readonly (FuelRecordForCalc & { fuelEconomy: number | null })[],
): { id: string; fuelEconomy: number | null }[] {
  const { perRecord } = calculateFuelEconomies(records)
  const changes: { id: string; fuelEconomy: number | null }[] = []
  for (const record of records) {
    const next = perRecord.get(record.id) ?? null
    if (next !== record.fuelEconomy) {
      changes.push({ id: record.id, fuelEconomy: next })
    }
  }
  return changes
}

/**
 * 入力途中の給油の燃費プレビュー(S-02 の保存前表示用)。
 * 満タンON + ODO・給油量入力済みのときのみ値を返す。金額の有無は関係ない。
 *
 * @param existingRecords 対象車両の既存の全給油記録(保存済みのもの)
 * @param input           入力中の値
 */
export function previewFuelEconomy(
  existingRecords: readonly FuelRecordForCalc[],
  input: { odo: number; fuelAmount: number; isFullTank: boolean },
): { economy: number; distance: number } | null {
  if (!input.isFullTank || !(input.odo > 0) || !(input.fuelAmount > 0)) return null

  // 既存記録の末尾に仮追加して計算する(編集ではなく新規追加を想定)
  const draft: FuelRecordForCalc = {
    id: '__draft__',
    date: '9999-12-31', // 必ず最後に来るように
    odo: input.odo,
    fuelAmount: input.fuelAmount,
    isFullTank: true,
  }
  const { intervals } = calculateFuelEconomies([...existingRecords, draft])
  const last = intervals[intervals.length - 1]
  if (!last || last.endRecordId !== '__draft__') return null
  return { economy: last.economy, distance: last.distance }
}

/** 統計サマリ(S-01 平均燃費 / S-07 平均・ベスト・ワースト)を計算する */
export function calculateFuelStats(records: readonly FuelRecordForCalc[]): FuelStats {
  const { intervals } = calculateFuelEconomies(records)
  if (intervals.length === 0) {
    return { averageEconomy: null, best: null, worst: null, intervalCount: 0 }
  }

  let totalDistance = 0
  let totalFuel = 0
  let best = intervals[0]
  let worst = intervals[0]
  for (const interval of intervals) {
    totalDistance += interval.distance
    totalFuel += interval.fuelUsed
    if (interval.economy > best.economy) best = interval
    if (interval.economy < worst.economy) worst = interval
  }

  return {
    averageEconomy: totalFuel > 0 ? round2(totalDistance / totalFuel) : null,
    best,
    worst,
    intervalCount: intervals.length,
  }
}

/**
 * 指定月の燃料費合計(S-01「今月の燃料費」/ フェーズ2 F-16)。
 * 金額未入力(totalPrice が null/undefined)の記録は集計対象外とし、
 * その件数を excludedCount で返す(画面で「対象外◯件」と注記するため)。
 *
 * @param year  西暦(例: 2026)
 * @param month 月(1〜12)
 */
export function calculateMonthlyFuelCost(
  records: readonly FuelRecordForCalc[],
  year: number,
  month: number,
): MonthlyFuelCost {
  const prefix = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`
  let total = 0
  let includedCount = 0
  let excludedCount = 0
  for (const record of records) {
    if (!record.date.startsWith(prefix)) continue
    if (record.totalPrice === null || record.totalPrice === undefined) {
      excludedCount += 1
    } else {
      total += record.totalPrice
      includedCount += 1
    }
  }
  return { total, includedCount, excludedCount }
}

/**
 * 単価(円/L)の自動計算(S-02: 金額入力時のみ表示。小数1桁)。
 * 計算できない場合(給油量0など)は null。
 */
export function computeUnitPrice(totalPrice: number, fuelAmount: number): number | null {
  if (!(fuelAmount > 0) || !(totalPrice >= 0)) return null
  return Math.round((totalPrice / fuelAmount) * 10) / 10
}

/**
 * 総額(円)の自動計算(単価側から入力された場合の逆算。整数円)。
 */
export function computeTotalPrice(unitPrice: number, fuelAmount: number): number | null {
  if (!(fuelAmount > 0) || !(unitPrice >= 0)) return null
  return Math.round(unitPrice * fuelAmount)
}
