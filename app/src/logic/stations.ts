/**
 * 給油所名の集計(S-02/S-04 クイック選択用)
 * - UI・DB非依存の純粋関数
 */

/** 集計に必要な最小限のフィールド(FuelRecord はそのまま渡せる) */
export interface StationSourceRecord {
  /** 給油日 'YYYY-MM-DD'(文字列比較 = 時系列比較) */
  date: string
  stationName?: string | null
}

/**
 * よく使う給油所名を使用回数の多い順に最大 limit 件返す。
 *
 * - 表記は完全一致で集計(前後空白はトリム)。空・未設定の記録は無視
 * - 使用回数が同数の場合は直近に使った(給油日が新しい)方を優先。
 *   給油日まで同じ場合は配列の後ろにある方を優先
 * - records の並び順には依存しない
 */
export function frequentStations(records: StationSourceRecord[], limit = 3): string[] {
  const stats = new Map<string, { count: number; lastDate: string; lastIndex: number }>()

  records.forEach((record, index) => {
    const name = record.stationName?.trim()
    if (!name) return
    const s = stats.get(name)
    if (!s) {
      stats.set(name, { count: 1, lastDate: record.date, lastIndex: index })
      return
    }
    s.count += 1
    if (record.date > s.lastDate || (record.date === s.lastDate && index > s.lastIndex)) {
      s.lastDate = record.date
      s.lastIndex = index
    }
  })

  return [...stats.entries()]
    .sort(([, a], [, b]) => {
      if (a.count !== b.count) return b.count - a.count // 回数の多い順
      if (a.lastDate !== b.lastDate) return a.lastDate < b.lastDate ? 1 : -1 // 直近優先
      return b.lastIndex - a.lastIndex
    })
    .slice(0, Math.max(0, limit))
    .map(([name]) => name)
}
