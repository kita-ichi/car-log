/**
 * S-05 メンテナンス入力 / S-06 メンテナンス履歴一覧(+詳細・編集)
 * - 種別はチップのグリッド選択。「その他」選択時は名称入力欄を追加表示
 * - ODOヒントに「最新の給油記録: ◯km」
 * - バリデーションは validateMaintenanceRecord()(種別・ODO・日付必須。ODO警告は保存可)
 */
import { useEffect, useMemo, useState } from 'react'
import type { MaintenanceRecord, MaintenanceType } from '../../types/models'
import { fuelRecordRepository, maintenanceRepository } from '../../db/repositories'
import { validateMaintenanceRecord } from '../../logic/validation'
import { useApp } from '../AppContext'
import {
  ConfirmDialog,
  Fab,
  ListAppBar,
  ModalAppBar,
  TargetVehicleRow,
  WarnChips,
} from '../components'
import { ChevronRightIcon } from '../icons'
import {
  MAINTENANCE_TYPE_LABELS,
  fmtDateFull,
  fmtKm,
  fmtYen,
  maintenanceLabel,
  todayString,
} from '../format'

const TYPE_ORDER: MaintenanceType[] = [
  'oil_change',
  'oil_filter',
  'tire_change',
  'tire_rotation',
  'shaken',
  'legal_inspection',
  'battery',
  'wiper',
  'other',
]

interface FormState {
  type: MaintenanceType | null
  typeLabel: string
  date: string
  odo: string
  cost: string
  shopName: string
  memo: string
}

const toNum = (s: string): number | null => (s.trim() === '' ? null : Number(s))

/** フォーム本体(S-05 / 詳細・編集で共通) */
function MaintFormFields({
  form,
  setForm,
  latestFuelOdo,
}: {
  form: FormState
  setForm: React.Dispatch<React.SetStateAction<FormState>>
  /** 最新の給油記録のODO(ヒント表示・逆行警告に使用)。無ければ null */
  latestFuelOdo: number | null
}) {
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const result = useMemo(
    () =>
      validateMaintenanceRecord(
        { type: form.type, date: form.date, odo: toNum(form.odo), cost: toNum(form.cost) },
        { previousOdo: latestFuelOdo },
      ),
    [form.type, form.date, form.odo, form.cost, latestFuelOdo],
  )

  return (
    <>
      <TargetVehicleRow />

      <div className="card card-pad">
        <h2 className="card-h">
          種別 <span style={{ color: 'var(--c-danger)' }}>*</span>
        </h2>
        <div className="typegrid">
          {TYPE_ORDER.map((t) => (
            <button
              key={t}
              type="button"
              className={`chip${form.type === t ? ' active' : ''}`}
              onClick={() => set('type', t)}
            >
              {MAINTENANCE_TYPE_LABELS[t]}
            </button>
          ))}
        </div>
      </div>

      {form.type === 'other' && (
        <div className="field">
          <label htmlFor="m-typelabel">名称(その他)</label>
          <input
            id="m-typelabel"
            type="text"
            className="txt"
            placeholder="例: エアコンフィルタ交換"
            value={form.typeLabel}
            onChange={(e) => set('typeLabel', e.target.value)}
          />
        </div>
      )}

      <div className="field">
        <label htmlFor="m-date">実施日</label>
        <input
          id="m-date"
          type="date"
          value={form.date}
          onChange={(e) => set('date', e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="m-odo">
          ODOメーター <span className="req">*</span>
        </label>
        <div className="inrow">
          <input
            id="m-odo"
            type="number"
            inputMode="numeric"
            className="num-lg"
            placeholder={latestFuelOdo !== null ? String(latestFuelOdo) : '0'}
            value={form.odo}
            onChange={(e) => set('odo', e.target.value)}
          />
          <span className="unit">km</span>
        </div>
        {latestFuelOdo !== null && (
          <div className="hint">
            最新の給油記録: <span className="num">{fmtKm(latestFuelOdo)}</span> km
          </div>
        )}
        <WarnChips warnings={result.warnings} field="odo" />
      </div>

      <div className="field">
        <label htmlFor="m-cost">
          費用 <span className="opt">任意 ・ 0円可</span>
        </label>
        <div className="inrow">
          <input
            id="m-cost"
            type="number"
            inputMode="numeric"
            className="num-lg"
            placeholder="0"
            value={form.cost}
            onChange={(e) => set('cost', e.target.value)}
          />
          <span className="unit">円</span>
        </div>
        <WarnChips warnings={result.warnings} field="cost" />
      </div>

      <div className="field">
        <label htmlFor="m-shop">
          実施店舗 <span className="opt">任意</span>
        </label>
        <input
          id="m-shop"
          type="text"
          className="txt"
          placeholder="例: オートバックス環状店"
          value={form.shopName}
          onChange={(e) => set('shopName', e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="m-memo">
          メモ <span className="opt">任意</span>
        </label>
        <input
          id="m-memo"
          type="text"
          className="txt"
          placeholder="オイル銘柄・交換部品など"
          value={form.memo}
          onChange={(e) => set('memo', e.target.value)}
        />
      </div>
    </>
  )
}

/** 保存ボタン下の案内(必須: 種別・ODO) */
const missingNote = (form: FormState): string | null => {
  const missing = [form.type === null, form.odo.trim() === ''].filter(Boolean).length
  return missing > 0 ? `あと${missing}項目(必須は種別・ODOです)` : null
}

/* ================================================== S-05 メンテナンス入力 */

export function MaintNewScreen() {
  const { selectedVehicle, navigate, showToast } = useApp()
  const [form, setForm] = useState<FormState>({
    type: null,
    typeLabel: '',
    date: todayString(),
    odo: '',
    cost: '',
    shopName: '',
    memo: '',
  })
  const [latestFuelOdo, setLatestFuelOdo] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!selectedVehicle) return
    let cancelled = false
    void (async () => {
      const latest = await fuelRecordRepository.latestByVehicle(selectedVehicle.id)
      if (!cancelled) setLatestFuelOdo(latest?.odo ?? null)
    })()
    return () => {
      cancelled = true
    }
  }, [selectedVehicle])

  if (!selectedVehicle) return null

  const result = validateMaintenanceRecord(
    { type: form.type, date: form.date, odo: toNum(form.odo), cost: toNum(form.cost) },
    { previousOdo: latestFuelOdo },
  )

  const handleSave = async () => {
    if (!result.canSave || saving) return
    setSaving(true)
    try {
      await maintenanceRepository.create({
        vehicleId: selectedVehicle.id,
        type: form.type!,
        typeLabel: form.type === 'other' ? form.typeLabel.trim() || undefined : undefined,
        date: form.date,
        odo: toNum(form.odo)!,
        cost: toNum(form.cost),
        shopName: form.shopName.trim() || undefined,
        memo: form.memo.trim() || undefined,
      })
      showToast('メンテ記録を保存しました')
      navigate({ name: 'maint-list' })
    } catch (err) {
      console.error('メンテ記録の保存に失敗:', err)
      showToast('保存に失敗しました。もう一度お試しください')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="screen">
      <ModalAppBar
        title="メンテを記録"
        icon="close"
        onClose={() => navigate({ name: 'maint-list' })}
      />
      <div className="body-pad" style={{ gap: 12 }}>
        <MaintFormFields form={form} setForm={setForm} latestFuelOdo={latestFuelOdo} />
      </div>
      <div className="savebar">
        <button
          className="btn primary"
          disabled={!result.canSave || saving}
          onClick={() => void handleSave()}
        >
          保存する
        </button>
        {missingNote(form) !== null && <p className="note">{missingNote(form)}</p>}
      </div>
    </section>
  )
}

/* ================================================== S-06 詳細・編集(S-04と同構成) */

export function MaintDetailScreen({ id }: { id: string }) {
  const { navigate, showToast } = useApp()
  const [record, setRecord] = useState<MaintenanceRecord | null>(null)
  const [form, setForm] = useState<FormState | null>(null)
  const [latestFuelOdo, setLatestFuelOdo] = useState<number | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const rec = await maintenanceRepository.getById(id)
      if (cancelled || !rec) {
        if (!rec) navigate({ name: 'maint-list' })
        return
      }
      const latest = await fuelRecordRepository.latestByVehicle(rec.vehicleId)
      if (cancelled) return
      setRecord(rec)
      setLatestFuelOdo(latest?.odo ?? null)
      setForm({
        type: rec.type,
        typeLabel: rec.typeLabel ?? '',
        date: rec.date,
        odo: String(rec.odo),
        cost: rec.cost !== null ? String(rec.cost) : '',
        shopName: rec.shopName ?? '',
        memo: rec.memo ?? '',
      })
    })()
    return () => {
      cancelled = true
    }
  }, [id, navigate])

  if (!record || !form) {
    return (
      <section className="screen">
        <ModalAppBar
          title="メンテの詳細"
          icon="back"
          onClose={() => navigate({ name: 'maint-list' })}
        />
      </section>
    )
  }

  const result = validateMaintenanceRecord(
    { type: form.type, date: form.date, odo: toNum(form.odo), cost: toNum(form.cost) },
    { previousOdo: latestFuelOdo },
  )

  const handleSave = async () => {
    if (!result.canSave || saving) return
    setSaving(true)
    try {
      await maintenanceRepository.update(record.id, {
        type: form.type!,
        // 空欄 = null で「クリア」。undefined は「変更なし」になり旧値が残るので使わない。
        // 種別を「その他」→ 他種別に変えた場合も null で旧ラベルを確実に消す
        typeLabel: form.type === 'other' ? form.typeLabel.trim() || null : null,
        date: form.date,
        odo: toNum(form.odo)!,
        cost: toNum(form.cost),
        shopName: form.shopName.trim() || null,
        memo: form.memo.trim() || null,
      })
      showToast('変更を保存しました')
      navigate({ name: 'maint-list' })
    } catch (err) {
      console.error('メンテ記録の更新に失敗:', err)
      showToast('保存に失敗しました。もう一度お試しください')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    try {
      await maintenanceRepository.remove(record.id)
      setConfirmDelete(false)
      showToast('記録を削除しました')
      navigate({ name: 'maint-list' })
    } catch (err) {
      console.error('メンテ記録の削除に失敗:', err)
      setConfirmDelete(false)
      showToast('削除に失敗しました。もう一度お試しください')
    }
  }

  return (
    <section className="screen">
      <ModalAppBar
        title="メンテの詳細"
        icon="back"
        onClose={() => navigate({ name: 'maint-list' })}
      />
      <div className="body-pad" style={{ gap: 12 }}>
        <MaintFormFields
          form={form}
          setForm={(update) =>
            setForm((f) => (f === null ? f : typeof update === 'function' ? update(f) : update))
          }
          latestFuelOdo={latestFuelOdo}
        />
        <button className="btn danger-text" onClick={() => setConfirmDelete(true)}>
          この記録を削除する
        </button>
      </div>
      <div className="savebar">
        <button
          className="btn primary"
          disabled={!result.canSave || saving}
          onClick={() => void handleSave()}
        >
          変更を保存
        </button>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="このメンテ記録を削除しますか?"
        body={
          <>
            {maintenanceLabel(record.type, record.typeLabel)} ・ {fmtDateFull(record.date)} ・{' '}
            {fmtYen(record.cost)}
          </>
        }
        confirmLabel="削除する"
        onConfirm={() => void handleDelete()}
        onCancel={() => setConfirmDelete(false)}
      />
    </section>
  )
}

/* ================================================== S-06 メンテナンス履歴一覧 */

/** 種別フィルタ(§S-06): すべて / オイル / タイヤ / 車検・点検 / その他 */
const FILTERS: { key: string; label: string; types: MaintenanceType[] | null }[] = [
  { key: 'all', label: 'すべて', types: null },
  { key: 'oil', label: 'オイル', types: ['oil_change', 'oil_filter'] },
  { key: 'tire', label: 'タイヤ', types: ['tire_change', 'tire_rotation'] },
  { key: 'insp', label: '車検・点検', types: ['shaken', 'legal_inspection'] },
  { key: 'other', label: 'その他', types: ['battery', 'wiper', 'other'] },
]

export function MaintHistoryScreen() {
  const { selectedVehicle, navigate } = useApp()
  const [records, setRecords] = useState<MaintenanceRecord[]>([])
  const [filter, setFilter] = useState('all')
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!selectedVehicle) return
    let cancelled = false
    void (async () => {
      const list = await maintenanceRepository.listByVehicle(selectedVehicle.id)
      if (cancelled) return
      setRecords(list)
      setLoaded(true)
    })()
    return () => {
      cancelled = true
    }
  }, [selectedVehicle])

  const activeFilter = FILTERS.find((f) => f.key === filter) ?? FILTERS[0]
  const visible =
    activeFilter.types === null
      ? records
      : records.filter((r) => activeFilter.types!.includes(r.type))

  return (
    <section className="screen">
      <ListAppBar title="メンテ履歴" />

      <div className="body-pad" style={{ gap: 12 }}>
        <div className="chips">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              className={`chip${filter === f.key ? ' active' : ''}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>

        {loaded && visible.length === 0 ? (
          <div className="empty-state">
            {records.length === 0
              ? 'メンテナンス記録はまだありません。右下の「+」から記録しましょう。'
              : 'この種別の記録はありません。'}
          </div>
        ) : (
          <div className="list">
            {visible.map((m) => (
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
                <ChevronRightIcon size={18} className="chev" />
              </button>
            ))}
          </div>
        )}
        <div style={{ height: 80 }} />
      </div>

      <Fab label="メンテを記録" onClick={() => navigate({ name: 'maint-new' })} />
    </section>
  )
}
