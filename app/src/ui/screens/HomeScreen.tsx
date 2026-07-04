/**
 * S-01 ホーム(ダッシュボード)
 * - ヒーローパネル: 直近燃費(44px)+ 平均 / 前回比 / 今月の燃料費
 * - CTA: 給油を記録(アンバー64px)/ メンテを記録(ブルー)
 * - 燃費推移スパークライン(直近12回)/ 直近のメンテナンス
 * 数値はすべて logic/ の純粋関数で計算(UI側で再実装しない)
 */
import { useEffect, useMemo, useState } from 'react'
import type { FuelRecord, MaintenanceRecord } from '../../types/models'
import { fuelRecordRepository, maintenanceRepository } from '../../db/repositories'
import { calculateFuelStats, calculateMonthlyFuelCost } from '../../logic/fuelEconomy'
import { useApp } from '../AppContext'
import { ListAppBar } from '../components'
import { FuelIcon, WrenchIcon } from '../icons'
import {
  fmtDateFull,
  fmtEconomy,
  fmtInt,
  fmtKm,
  fmtYen,
  maintenanceLabel,
  todayLabel,
} from '../format'

/** スパークライン(直近12回の確定燃費)— インラインSVG */
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null
  const lo = Math.min(...values) - 0.3
  const hi = Math.max(...values) + 0.3
  const x = (i: number) => 4 + (i * 312) / (values.length - 1)
  const y = (v: number) => 50 - ((v - lo) / (hi - lo)) * 44
  const points = values.map((v, i) => `${x(i)},${y(v)}`).join(' ')
  const last = values[values.length - 1]
  return (
    <svg
      width="100%"
      height="56"
      viewBox="0 0 320 56"
      preserveAspectRatio="none"
      aria-label="燃費ミニグラフ"
    >
      <polyline
        points={points}
        fill="none"
        stroke="#1D5BBF"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle
        cx={x(values.length - 1)}
        cy={y(last)}
        r="3.5"
        fill="#F5A524"
        stroke="#fff"
        strokeWidth="1.5"
      />
    </svg>
  )
}

export function HomeScreen() {
  const { selectedVehicle, navigate } = useApp()
  const [records, setRecords] = useState<FuelRecord[]>([])
  const [maintenances, setMaintenances] = useState<MaintenanceRecord[]>([])

  useEffect(() => {
    if (!selectedVehicle) return
    let cancelled = false
    void (async () => {
      const [fuels, maints] = await Promise.all([
        fuelRecordRepository.listByVehicle(selectedVehicle.id, 'asc'),
        maintenanceRepository.listByVehicle(selectedVehicle.id),
      ])
      if (cancelled) return
      setRecords(fuels)
      setMaintenances(maints.slice(0, 3))
    })()
    return () => {
      cancelled = true
    }
  }, [selectedVehicle])

  const stats = useMemo(() => calculateFuelStats(records), [records])
  const confirmed = useMemo(() => records.filter((r) => r.fuelEconomy !== null), [records])
  const recent = confirmed[confirmed.length - 1]?.fuelEconomy ?? null
  const previous = confirmed[confirmed.length - 2]?.fuelEconomy ?? null
  const diff = recent !== null && previous !== null ? recent - previous : null

  const now = new Date()
  const monthly = useMemo(
    () => calculateMonthlyFuelCost(records, now.getFullYear(), now.getMonth() + 1),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [records],
  )

  const sparkValues = confirmed.slice(-12).map((r) => r.fuelEconomy!)

  return (
    <section className="screen">
      <ListAppBar right={<span className="sub-title num">{todayLabel()}</span>} />

      <div className="hero">
        <div className="lbl">直近の燃費</div>
        <div className="big num">
          {fmtEconomy(recent)}
          <small>km/L</small>
        </div>
        {records.length === 0 ? (
          <div className="meta">
            <span>最初の給油を記録しましょう</span>
          </div>
        ) : (
          <div className="meta">
            <span>
              平均 <b className="num">{fmtEconomy(stats.averageEconomy)}</b> km/L
            </span>
            {diff !== null && (
              <span>
                前回比{' '}
                <b className={diff >= 0 ? 'trend-up' : 'trend-down'}>
                  {diff >= 0 ? '+' : ''}
                  {diff.toFixed(1)}
                </b>
              </span>
            )}
            <span>
              今月の燃料費 <b className="num">¥{fmtInt(monthly.total)}</b>
              {monthly.excludedCount > 0 && (
                <span style={{ fontSize: 11 }}>(金額なし{monthly.excludedCount}件は対象外)</span>
              )}
            </span>
          </div>
        )}
      </div>

      <div className="body-pad" style={{ flex: 1 }}>
        <div className="home-cta">
          <button className="btn primary xl" onClick={() => navigate({ name: 'fuel-new' })}>
            <FuelIcon size={24} />
            給油を記録
          </button>
          <button className="btn secondary" onClick={() => navigate({ name: 'maint-new' })}>
            <WrenchIcon size={20} />
            メンテを記録
          </button>
        </div>

        <div className="card">
          <div
            className="card-pad"
            style={{ paddingBottom: 8, display: 'flex', alignItems: 'center' }}
          >
            <h2 className="card-h" style={{ margin: 0, flex: 1 }}>
              燃費の推移(直近12回)
            </h2>
            <button className="link" onClick={() => navigate({ name: 'graph' })}>
              グラフを見る
            </button>
          </div>
          <div
            style={{ padding: '0 16px 16px', cursor: 'pointer' }}
            onClick={() => navigate({ name: 'graph' })}
            role="button"
          >
            {sparkValues.length >= 2 ? (
              <Sparkline values={sparkValues} />
            ) : (
              <p className="sub" style={{ margin: 0 }}>
                燃費が2回以上確定すると推移が表示されます(満タン給油3回が目安です)
              </p>
            )}
          </div>
        </div>

        <div className="card">
          <div
            className="card-pad"
            style={{ paddingBottom: 8, display: 'flex', alignItems: 'center' }}
          >
            <h2 className="card-h" style={{ margin: 0, flex: 1 }}>
              直近のメンテナンス
            </h2>
            <button className="link" onClick={() => navigate({ name: 'maint-list' })}>
              すべて見る
            </button>
          </div>
          {maintenances.length === 0 ? (
            <p className="sub" style={{ margin: 0, padding: '0 16px 16px' }}>
              メンテナンス記録はまだありません
            </p>
          ) : (
            maintenances.map((m) => (
              <button
                key={m.id}
                className="row"
                onClick={() => navigate({ name: 'maint-detail', id: m.id })}
              >
                <div className="grow">
                  <div style={{ fontWeight: 700 }}>{maintenanceLabel(m.type, m.typeLabel)}</div>
                  <div className="sub num">
                    {[fmtDateFull(m.date), `${fmtKm(m.odo)} km`, m.shopName]
                      .filter(Boolean)
                      .join(' ・ ')}
                  </div>
                </div>
                <div className="num" style={{ fontWeight: 700 }}>
                  {fmtYen(m.cost)}
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </section>
  )
}
