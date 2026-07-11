import { describe, expect, it } from 'vitest'
import { frequentStations, type StationSourceRecord } from './stations'

const rec = (date: string, stationName?: string | null): StationSourceRecord => ({
  date,
  stationName,
})

describe('frequentStations(よく使う給油所)', () => {
  it('使用回数の多い順に最大3件返す', () => {
    // ENEOS 4回 / 出光 3回 / コスモ 2回 / apollostation 1回(4件目は落ちる)
    const records = [
      rec('2026-05-01', 'ENEOS 環状店'),
      rec('2026-05-05', '出光 中央SS'),
      rec('2026-05-10', 'ENEOS 環状店'),
      rec('2026-05-15', 'コスモ 石油駅前'),
      rec('2026-05-20', '出光 中央SS'),
      rec('2026-06-01', 'ENEOS 環状店'),
      rec('2026-06-10', 'コスモ 石油駅前'),
      rec('2026-06-15', '出光 中央SS'),
      rec('2026-06-20', 'ENEOS 環状店'),
      rec('2026-06-28', 'apollostation 港店'),
    ]
    expect(frequentStations(records)).toEqual(['ENEOS 環状店', '出光 中央SS', 'コスモ 石油駅前'])
  })

  it('4種類以上あっても3件に絞られる(limit 既定値)', () => {
    const records = [
      rec('2026-06-01', 'A'),
      rec('2026-06-02', 'A'),
      rec('2026-06-03', 'B'),
      rec('2026-06-04', 'B'),
      rec('2026-06-05', 'C'),
      rec('2026-06-06', 'C'),
      rec('2026-06-07', 'D'),
    ]
    expect(frequentStations(records)).toHaveLength(3)
    expect(frequentStations(records)).not.toContain('D')
  })

  it('limit を指定できる', () => {
    const records = [rec('2026-06-01', 'A'), rec('2026-06-02', 'B')]
    expect(frequentStations(records, 1)).toEqual(['B']) // 同数(各1回)なので直近優先
  })

  it('使用回数が同数のときは直近に使った方を優先', () => {
    const records = [
      rec('2026-06-01', '古い方'),
      rec('2026-06-10', '新しい方'),
      rec('2026-06-05', '古い方'),
      rec('2026-06-20', '新しい方'),
    ]
    expect(frequentStations(records)).toEqual(['新しい方', '古い方'])
  })

  it('並び順に依存しない(降順で渡しても同じ結果)', () => {
    const asc = [
      rec('2026-06-01', '古い方'),
      rec('2026-06-10', '新しい方'),
      rec('2026-06-05', '古い方'),
      rec('2026-06-20', '新しい方'),
    ]
    const desc = [...asc].reverse()
    expect(frequentStations(desc)).toEqual(frequentStations(asc))
  })

  it('3件未満ならある分だけ返す', () => {
    expect(frequentStations([rec('2026-06-01', 'ENEOS 環状店')])).toEqual(['ENEOS 環状店'])
  })

  it('記録0件なら空配列', () => {
    expect(frequentStations([])).toEqual([])
  })

  it('給油所名が空・空白のみ・未設定の記録は無視する', () => {
    const records = [
      rec('2026-06-01', ''),
      rec('2026-06-02', '   '),
      rec('2026-06-03', undefined),
      rec('2026-06-04', null),
      rec('2026-06-05', 'ENEOS 環状店'),
    ]
    expect(frequentStations(records)).toEqual(['ENEOS 環状店'])
  })

  it('前後の空白はトリムして同一表記として集計する', () => {
    const records = [
      rec('2026-06-01', ' ENEOS 環状店 '),
      rec('2026-06-05', 'ENEOS 環状店'),
      rec('2026-06-10', '出光 中央SS'),
      rec('2026-06-11', '出光 中央SS'),
      rec('2026-06-12', '出光 中央SS'),
    ]
    // トリム後の同一表記は合算(2回)。返す名前もトリム済み
    expect(frequentStations(records)).toEqual(['出光 中央SS', 'ENEOS 環状店'])
  })
})
