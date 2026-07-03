/**
 * S-07 燃費グラフ(Recharts)
 * - 期間切替チップ: 直近12回(初期値)/ 半年 / 1年 / 全期間
 * - 上段サマリ: 平均 / ベスト(緑)/ ワースト(赤)— 期間内の確定区間から算出
 * - 折れ線+平均燃費ライン(アンバー点線)。部分給油(未確定)は点を打たない
 * - 点タップ → 詳細チップ →「詳細を見る」で S-04 へ
 */
import { useEffect, useMemo, useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts'
import type { FuelRecord } from '../../types/models'
import { fuelRecordRepository } from '../../db/repositories'
import { calculateFuelEconomies } from '../../logic/fuelEconomy'
import { useApp } from '../AppContext'
import { ListAppBar } from '../components'
import { fmtEconomy, fmtMonthDay } from '../format'

type PeriodKey = 'last12' | 'half' | 'year' | 'all'

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: 'last12', label: '直近12回' },
  { key: 'half', label: '半年' },
  { key: 'year', label: '1年' },
  { key: 'all', label: '全期間' },
]

interface Point {
  id: string
  date: string
  label: string
  economy: number
  distance: number
  fuelUsed: number
}

/** n ヶ月前の 'YYYY-MM-DD' */
const monthsAgo = (n: number): string => {
  const d = new Date()
  d.setMonth(d.getMonth() - n)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

export function GraphScreen() {
  const { selectedVehicle, navigate } = useApp()
  const [records, setRecords] = useState<FuelRecord[]>([])
  const [period, setPeriod] = useState<PeriodKey>('last12')
  const [selected, setSelected] = useState<Point | null>(null)

  useEffect(() => {
    if (!selectedVehicle) return
    let cancelled = false
    void (async () => {
      const list = await fuelRecordRepository.listByVehicle(selectedVehicle.id, 'asc')
      if (!cancelled) {
        setRecords(list)
        setSelected(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selectedVehicle])

  // 確定区間(満タン法)— logic/ の純粋関数で計算(UI側で再実装しない)
  const allPoints = useMemo<Point[]>(() => {
    const { intervals } = calculateFuelEconomies(records)
    const byId = new Map(records.map((r) => [r.id, r]))
    return intervals.flatMap((iv) => {
      const rec = byId.get(iv.endRecordId)
      if (!rec) return []
      return [
        {
          id: rec.id,
          date: rec.date,
          label: fmtMonthDay(rec.date),
          economy: iv.economy,
          distance: iv.distance,
          fuelUsed: iv.fuelUsed,
        },
      ]
    })
  }, [records])

  const points = useMemo<Point[]>(() => {
    switch (period) {
      case 'last12':
        return allPoints.slice(-12)
      case 'half':
        return allPoints.filter((p) => p.date >= monthsAgo(6))
      case 'year':
        return allPoints.filter((p) => p.date >= monthsAgo(12))
      case 'all':
        return allPoints
    }
  }, [allPoints, period])

  // 期間内サマリ(平均 = 総走行距離 ÷ 総給油量。単純平均ではない — 要件 §6.1)
  const summary = useMemo(() => {
    if (points.length === 0) return null
    let dist = 0
    let fuel = 0
    let best = points[0]
    let worst = points[0]
    for (const p of points) {
      dist += p.distance
      fuel += p.fuelUsed
      if (p.economy > best.economy) best = p
      if (p.economy < worst.economy) worst = p
    }
    return {
      average: fuel > 0 ? Math.round((dist / fuel) * 100) / 100 : null,
      best: best.economy,
      worst: worst.economy,
    }
  }, [points])

  const handlePointTap = (payload: unknown) => {
    if (payload && typeof payload === 'object' && 'id' in payload) {
      setSelected(payload as Point)
    }
  }

  return (
    <section className="screen">
      <ListAppBar title="燃費グラフ" />

      <div className="body-pad" style={{ gap: 12 }}>
        <div className="chips">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              className={`chip${period === p.key ? ' active' : ''}`}
              onClick={() => {
                setPeriod(p.key)
                setSelected(null)
              }}
            >
              {p.label}
            </button>
          ))}
        </div>

        {points.length === 0 ? (
          <div className="card">
            <div className="empty-state">
              この期間に確定した燃費データがありません。
              <br />
              満タン給油を2回記録すると燃費が確定します。
            </div>
          </div>
        ) : (
          <div className="card">
            <div className="card-pad" style={{ paddingBottom: 0, display: 'flex', gap: 20 }}>
              <div>
                <div className="card-h" style={{ margin: 0 }}>
                  平均燃費
                </div>
                <div className="num" style={{ fontSize: 24, fontWeight: 700 }}>
                  {fmtEconomy(summary?.average ?? null)} <span className="sub">km/L</span>
                </div>
              </div>
              <div>
                <div className="card-h" style={{ margin: 0 }}>
                  ベスト
                </div>
                <div
                  className="num"
                  style={{ fontSize: 24, fontWeight: 700, color: 'var(--c-success)' }}
                >
                  {fmtEconomy(summary?.best ?? null)} <span className="sub">km/L</span>
                </div>
              </div>
              <div>
                <div className="card-h" style={{ margin: 0 }}>
                  ワースト
                </div>
                <div
                  className="num"
                  style={{ fontSize: 24, fontWeight: 700, color: 'var(--c-danger)' }}
                >
                  {fmtEconomy(summary?.worst ?? null)} <span className="sub">km/L</span>
                </div>
              </div>
            </div>

            <div style={{ padding: '12px 8px 4px' }}>
              <ResponsiveContainer width="100%" height={230}>
                <LineChart
                  data={points}
                  margin={{ top: 12, right: 16, bottom: 0, left: -16 }}
                  onClick={(state) => {
                    // Recharts 3 の型にはタップ時の activePayload が含まれないためキャストして参照
                    const payload = (
                      state as unknown as { activePayload?: { payload?: Point }[] }
                    )?.activePayload?.[0]?.payload
                    if (payload) handlePointTap(payload)
                  }}
                >
                  <CartesianGrid stroke="#E3E9F0" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 10, fill: '#617082' }}
                    tickLine={false}
                    axisLine={{ stroke: '#E3E9F0' }}
                    interval="preserveStartEnd"
                    minTickGap={24}
                  />
                  <YAxis
                    domain={[
                      (dataMin: number) => Math.floor(dataMin - 0.6),
                      (dataMax: number) => Math.ceil(dataMax + 0.6),
                    ]}
                    tick={{ fontSize: 10, fill: '#617082' }}
                    tickLine={false}
                    axisLine={false}
                    width={44}
                  />
                  {summary?.average != null && (
                    <ReferenceLine
                      y={summary.average}
                      stroke="#B26E00"
                      strokeWidth={1.5}
                      strokeDasharray="5 4"
                      label={{
                        value: `平均 ${fmtEconomy(summary.average)}`,
                        position: 'insideTopRight',
                        fontSize: 10,
                        fill: '#B26E00',
                        fontWeight: 700,
                      }}
                    />
                  )}
                  <Line
                    type="linear"
                    dataKey="economy"
                    stroke="#1D5BBF"
                    strokeWidth={2.5}
                    dot={{ r: 4, fill: '#fff', stroke: '#1D5BBF', strokeWidth: 2.5 }}
                    activeDot={{
                      r: 9, // タップ領域 半径9px以上(§S-07)
                      fill: '#1D5BBF',
                      stroke: '#fff',
                      strokeWidth: 2,
                      cursor: 'pointer',
                      onClick: (_e: unknown, dotPayload: unknown) => {
                        const p = (dotPayload as { payload?: Point } | undefined)?.payload
                        if (p) handlePointTap(p)
                      },
                    }}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {selected !== null && (
              <div className="graph-tip">
                <div className="grow num">
                  <b>{selected.label}</b> の給油 ・ 燃費 <b>{fmtEconomy(selected.economy)}</b> km/L
                </div>
                <button
                  className="link"
                  onClick={() => navigate({ name: 'fuel-detail', id: selected.id })}
                >
                  詳細を見る
                </button>
              </div>
            )}
          </div>
        )}
        <p className="sub" style={{ margin: '0 4px' }}>
          グラフの点をタップすると該当する給油の詳細を確認できます。点線は期間平均です。
        </p>
      </div>
    </section>
  )
}
