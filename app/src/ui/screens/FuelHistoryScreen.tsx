/**
 * S-03 給油履歴一覧
 * - 日付降順リスト: 日付 / 給油量・金額 / 単価・満タン区分バッジ / 燃費バッジ
 * - 金額なし記録は「¥ —」「@— 円/L」表示
 * - FAB(+)→ S-02 / 行タップ → S-04 / 「グラフ」→ S-07
 */
import { useEffect, useState } from 'react'
import type { FuelRecord } from '../../types/models'
import { fuelRecordRepository } from '../../db/repositories'
import { useApp } from '../AppContext'
import { Fab, ListAppBar } from '../components'
import { ChevronRightIcon } from '../icons'
import {
  fmtEconomy,
  fmtLiters,
  fmtMonthDay,
  fmtUnitPrice,
  fmtWeekday,
  fmtYen,
} from '../format'

export function FuelHistoryScreen() {
  const { selectedVehicle, navigate } = useApp()
  const [records, setRecords] = useState<FuelRecord[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!selectedVehicle) return
    let cancelled = false
    void (async () => {
      const list = await fuelRecordRepository.listByVehicle(selectedVehicle.id, 'desc')
      if (cancelled) return
      setRecords(list)
      setLoaded(true)
    })()
    return () => {
      cancelled = true
    }
  }, [selectedVehicle])

  return (
    <section className="screen">
      <ListAppBar
        title="給油履歴"
        right={
          <button className="txtbtn" onClick={() => navigate({ name: 'graph' })}>
            グラフ
          </button>
        }
      />

      <div className="body-pad" style={{ gap: 8 }}>
        {loaded && records.length === 0 ? (
          <div className="empty-state">
            給油記録はまだありません。
            <br />
            右下の「+」から最初の給油を記録しましょう。
          </div>
        ) : (
          <div className="list">
            {records.map((r) => (
              <button
                key={r.id}
                className="row"
                onClick={() => navigate({ name: 'fuel-detail', id: r.id })}
              >
                <div className="date-col">
                  <div className="md num">{fmtMonthDay(r.date)}</div>
                  <div className="wd">{fmtWeekday(r.date)}</div>
                </div>
                <div className="grow">
                  <div className="num" style={{ fontWeight: 700 }}>
                    {fmtLiters(r.fuelAmount)} L ・ {fmtYen(r.totalPrice)}
                  </div>
                  <div className="sub num">
                    {fmtUnitPrice(r.unitPrice)} ・{' '}
                    <span className={`badge ${r.isFullTank ? 'full' : 'part'}`}>
                      {r.isFullTank ? '満タン' : '部分給油'}
                    </span>
                  </div>
                </div>
                {r.fuelEconomy !== null ? (
                  <span className="badge fe num">{fmtEconomy(r.fuelEconomy)} km/L</span>
                ) : (
                  <span className="badge wait">計算待ち</span>
                )}
                <ChevronRightIcon size={18} className="chev" />
              </button>
            ))}
          </div>
        )}
        {records.length > 0 && (
          <p className="sub" style={{ margin: '0 4px' }}>
            「計算待ち」は部分給油の記録です。次の満タン給油時にまとめて燃費が確定します。金額は任意入力のため、未入力の記録は金額・単価を「—」と表示します。
          </p>
        )}
        <div style={{ height: 80 }} />
      </div>

      <Fab label="給油を記録" onClick={() => navigate({ name: 'fuel-new' })} />
    </section>
  )
}
