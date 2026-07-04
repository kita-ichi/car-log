/**
 * S-02 給油入力【最重要画面】/ S-04 給油詳細・編集
 * - バリデーションは validateFuelRecord() をライブ呼び出し(§0.2)
 *   errors → 保存ボタン無効化 / warnings → アンバーチップ表示のみ(保存はブロックしない)
 * - 燃費・単価の計算はUI側で再実装しない:
 *   保存は fuelRecordRepository(燃費キャッシュ自動再計算)、
 *   プレビューは previewFuelEconomy()、単価表示は computeUnitPrice()
 */
import { useEffect, useMemo, useState } from 'react'
import type { FuelRecord, Vehicle } from '../../types/models'
import { fuelRecordRepository, vehicleRepository } from '../../db/repositories'
import {
  calculateFuelEconomies,
  computeUnitPrice,
  findPreviousRecord,
  previewFuelEconomy,
} from '../../logic/fuelEconomy'
import { validateFuelRecord, type ValidationResult } from '../../logic/validation'
import { useApp } from '../AppContext'
import {
  ConfirmDialog,
  FullTankSwitch,
  ModalAppBar,
  TargetVehicleRow,
  WarnChips,
} from '../components'
import { fmtDateFull, fmtEconomy, fmtKm, fmtLiters, fmtYen, todayString } from '../format'

interface FormState {
  date: string
  odo: string
  fuelAmount: string
  totalPrice: string
  isFullTank: boolean
  stationName: string
  memo: string
}

/** 入力文字列 → 数値(未入力は null) */
const toNum = (s: string): number | null => (s.trim() === '' ? null : Number(s))

/** フォーム本体(S-02/S-04 共通)。context(既存記録・前回値)は呼び出し側でロード */
function FuelRecordFormFields({
  form,
  setForm,
  existing,
  previousOdo,
  previousUnitPrice,
  result,
  showPreview,
  fixedVehicle,
}: {
  form: FormState
  setForm: React.Dispatch<React.SetStateAction<FormState>>
  /** 対象車両の既存記録(編集時は自分を除く)— 時系列昇順 */
  existing: FuelRecord[]
  previousOdo: number | null
  previousUnitPrice: number | null
  /** ライブバリデーション結果(親で1回だけ計算して渡す) */
  result: ValidationResult
  /** 保存前の燃費プレビューを表示するか(S-02 のみ) */
  showPreview: boolean
  /** 編集時(S-04): 記録の車両を表示専用で出す(切り替え不可)。新規時は undefined */
  fixedVehicle?: Vehicle | null
}) {
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const odo = toNum(form.odo)
  const fuelAmount = toNum(form.fuelAmount)
  const totalPrice = toNum(form.totalPrice)

  // 単価のライブ表示(金額入力時のみ — §0.3)
  const unitPrice =
    totalPrice !== null && fuelAmount !== null ? computeUnitPrice(totalPrice, fuelAmount) : null

  // 燃費プレビュー(満タンON+ODO・給油量入力済み。金額不要 — S-02 §7)
  // date も渡す: 過去日付の後追い入力でも実際の時系列位置(直前の満タン→入力)で計算する
  const preview = useMemo(() => {
    if (!showPreview || odo === null || fuelAmount === null) return null
    return previewFuelEconomy(existing, {
      odo,
      fuelAmount,
      isFullTank: form.isFullTank,
      date: form.date,
    })
  }, [showPreview, existing, odo, fuelAmount, form.isFullTank, form.date])

  return (
    <>
      <TargetVehicleRow vehicle={fixedVehicle} />

      <div className="field">
        <label htmlFor="f-date">給油日</label>
        <input
          id="f-date"
          type="date"
          value={form.date}
          onChange={(e) => set('date', e.target.value)}
        />
        <WarnChips warnings={result.warnings} field="date" />
      </div>

      <div className="field">
        <label htmlFor="f-odo">
          ODOメーター <span className="req">*</span>
        </label>
        <div className="inrow">
          <input
            id="f-odo"
            type="number"
            inputMode="numeric"
            className="num-lg"
            placeholder={previousOdo !== null ? String(previousOdo) : '0'}
            value={form.odo}
            onChange={(e) => set('odo', e.target.value)}
          />
          <span className="unit">km</span>
        </div>
        {previousOdo !== null && (
          <div className="hint">
            前回: <span className="num">{fmtKm(previousOdo)}</span> km
          </div>
        )}
        <WarnChips warnings={result.warnings} field="odo" />
      </div>

      <div className="field">
        <label htmlFor="f-amount">
          給油量 <span className="req">*</span>
        </label>
        <div className="inrow">
          <input
            id="f-amount"
            type="number"
            inputMode="decimal"
            step="0.01"
            className="num-lg"
            placeholder="0.00"
            value={form.fuelAmount}
            onChange={(e) => set('fuelAmount', e.target.value)}
          />
          <span className="unit">L</span>
        </div>
        <WarnChips warnings={result.warnings} field="fuelAmount" />
      </div>

      <div className="field">
        <label htmlFor="f-price">
          支払金額(総額) <span className="opt">任意</span>
        </label>
        <div className="inrow">
          <input
            id="f-price"
            type="number"
            inputMode="numeric"
            className="num-lg"
            placeholder="—"
            value={form.totalPrice}
            onChange={(e) => set('totalPrice', e.target.value)}
          />
          <span className="unit">円</span>
        </div>
        <div className="auto num">
          {unitPrice !== null
            ? `単価 ≒ ${unitPrice} 円/L(自動計算)`
            : previousUnitPrice !== null
              ? `単価は金額を入力すると自動計算されます(前回 ${previousUnitPrice} 円/L)`
              : '単価は金額を入力すると自動計算されます'}
        </div>
        <WarnChips warnings={result.warnings} field="totalPrice" />
      </div>

      <FullTankSwitch checked={form.isFullTank} onChange={(v) => set('isFullTank', v)} />

      {preview !== null && (
        <div className="calc-summary">
          <div className="item">
            <div className="l">この区間の燃費</div>
            <div className="v num">
              {fmtEconomy(preview.economy)} <small>km/L</small>
            </div>
          </div>
          <div className="item">
            <div className="l">走行距離</div>
            <div className="v plain num">
              {fmtKm(preview.distance)} <small>km</small>
            </div>
          </div>
        </div>
      )}

      <div className="field">
        <label htmlFor="f-station">
          給油所名 <span className="opt">任意</span>
        </label>
        <input
          id="f-station"
          type="text"
          className="txt"
          placeholder="例: ENEOS 環状店"
          value={form.stationName}
          onChange={(e) => set('stationName', e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="f-memo">
          メモ <span className="opt">任意</span>
        </label>
        <input
          id="f-memo"
          type="text"
          className="txt"
          placeholder="高速走行が多め など"
          value={form.memo}
          onChange={(e) => set('memo', e.target.value)}
        />
      </div>
    </>
  )
}

/** 必須未入力の件数(ODO・給油量の2項目のみ必須 — §S-02) */
const missingCount = (form: FormState): number =>
  [form.odo, form.fuelAmount].filter((v) => v.trim() === '').length

/* ================================================== S-02 給油入力 */

export function FuelNewScreen() {
  const { selectedVehicle, navigate, showToast } = useApp()
  const [form, setForm] = useState<FormState>({
    date: todayString(),
    odo: '',
    fuelAmount: '',
    totalPrice: '',
    isFullTank: true, // 初期値ON(§S-02)
    stationName: '',
    memo: '',
  })
  const [existing, setExisting] = useState<FuelRecord[]>([])
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)

  // 既存記録のロード+前回給油所名の初期表示(§S-02 #8)
  useEffect(() => {
    if (!selectedVehicle) return
    let cancelled = false
    void (async () => {
      const records = await fuelRecordRepository.listByVehicle(selectedVehicle.id, 'asc')
      if (cancelled) return
      setExisting(records)
      const latest = records[records.length - 1]
      if (latest?.stationName) {
        setForm((f) => (f.stationName === '' ? { ...f, stationName: latest.stationName! } : f))
      }
      setLoaded(true)
    })()
    return () => {
      cancelled = true
    }
  }, [selectedVehicle])

  if (!selectedVehicle) return null

  // 前回値(逆行警告・ヒント)の基準: 入力日付の「直前」の記録。
  // 過去日付の後追い入力では最新記録ではなく時系列上の直前と比較する
  const previousOdo = findPreviousRecord(existing, form.date)?.odo ?? selectedVehicle.initialOdo
  const previousUnitPrice = existing[existing.length - 1]?.unitPrice ?? null

  const odo = toNum(form.odo)
  const fuelAmount = toNum(form.fuelAmount)
  const totalPrice = toNum(form.totalPrice)
  const result = validateFuelRecord(
    { date: form.date, odo, fuelAmount, totalPrice, isFullTank: form.isFullTank },
    {
      previousOdo,
      tankCapacity: selectedVehicle.tankCapacity ?? null,
      existingRecords: existing,
    },
  )
  const missing = missingCount(form)

  const handleSave = async () => {
    if (!result.canSave || saving) return
    setSaving(true)
    try {
      // 保存(燃費の再計算はリポジトリ層が自動で行う)
      const saved = await fuelRecordRepository.create({
        vehicleId: selectedVehicle.id,
        date: form.date,
        odo: odo!,
        fuelAmount: fuelAmount!,
        totalPrice: totalPrice,
        isFullTank: form.isFullTank,
        stationName: form.stationName.trim() || undefined,
        memo: form.memo.trim() || undefined,
      })
      // 戻り値の算出燃費をトーストに使う(§0.2)
      showToast(
        saved.fuelEconomy !== null
          ? `保存しました(燃費 ${fmtEconomy(saved.fuelEconomy)} km/L)`
          : '保存しました(燃費は次の満タン給油で確定します)',
      )
      navigate({ name: 'home' })
    } catch (err) {
      console.error('給油記録の保存に失敗:', err)
      showToast('保存に失敗しました。もう一度お試しください')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="screen">
      <ModalAppBar title="給油を記録" icon="close" onClose={() => navigate({ name: 'home' })} />
      <div className="body-pad" style={{ gap: 12 }}>
        {loaded && (
          <FuelRecordFormFields
            form={form}
            setForm={setForm}
            existing={existing}
            previousOdo={previousOdo}
            previousUnitPrice={previousUnitPrice}
            result={result}
            showPreview
          />
        )}
      </div>
      <div className="savebar">
        <button
          className="btn primary"
          disabled={!result.canSave || saving}
          onClick={() => void handleSave()}
        >
          保存する
        </button>
        <p className="note">
          {missing > 0
            ? `あと${missing}項目(必須はODO・給油量のみ。金額は任意)`
            : result.canSave
              ? '入力OK。保存すると燃費が計算されます'
              : result.errors[0]?.message}
        </p>
      </div>
    </section>
  )
}

/* ================================================== S-04 給油詳細・編集 */

export function FuelDetailScreen({ id }: { id: string }) {
  const { navigate, showToast } = useApp()
  const [record, setRecord] = useState<FuelRecord | null>(null)
  /** この記録の対象車両(record.vehicleId)。選択中車両とは別物なので必ずこちらを使う */
  const [vehicle, setVehicle] = useState<Vehicle | null>(null)
  const [form, setForm] = useState<FormState | null>(null)
  /** 自分を除く既存記録(時系列昇順) */
  const [others, setOthers] = useState<FuelRecord[]>([])
  /** この記録が確定させた区間の走行距離(満タン法) */
  const [distance, setDistance] = useState<number | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const rec = await fuelRecordRepository.getById(id)
      if (cancelled || !rec) {
        if (!rec) navigate({ name: 'fuel-list' })
        return
      }
      const [all, veh] = await Promise.all([
        fuelRecordRepository.listByVehicle(rec.vehicleId, 'asc'),
        vehicleRepository.getById(rec.vehicleId),
      ])
      if (cancelled) return
      setRecord(rec)
      setVehicle(veh ?? null)
      setOthers(all.filter((r) => r.id !== rec.id))
      // 走行距離: 満タン法の確定区間から取得(UI側で再計算しない)
      const { intervals } = calculateFuelEconomies(all)
      const interval = intervals.find((iv) => iv.endRecordId === rec.id)
      setDistance(interval?.distance ?? null)
      setForm({
        date: rec.date,
        odo: String(rec.odo),
        fuelAmount: String(rec.fuelAmount),
        totalPrice: rec.totalPrice !== null ? String(rec.totalPrice) : '',
        isFullTank: rec.isFullTank,
        stationName: rec.stationName ?? '',
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
        <ModalAppBar title="給油の詳細" icon="back" onClose={() => navigate({ name: 'fuel-list' })} />
      </section>
    )
  }

  // 編集時の前回ODO: 編集中の日付の「直前」の記録(自分を除く)。
  // 日付を変更した場合もその位置での直前記録と比較する。
  // 基準は選択中車両ではなく「この記録の車両」(record.vehicleId)
  const previousOdo = findPreviousRecord(others, form.date)?.odo ?? vehicle?.initialOdo ?? null

  const odo = toNum(form.odo)
  const fuelAmount = toNum(form.fuelAmount)
  const totalPrice = toNum(form.totalPrice)
  const result = validateFuelRecord(
    { date: form.date, odo, fuelAmount, totalPrice, isFullTank: form.isFullTank },
    {
      previousOdo,
      tankCapacity: vehicle?.tankCapacity ?? null,
      existingRecords: others,
    },
  )
  const missing = missingCount(form)

  const handleSave = async () => {
    if (!result.canSave || saving) return
    setSaving(true)
    try {
      await fuelRecordRepository.update(record.id, {
        date: form.date,
        odo: odo!,
        fuelAmount: fuelAmount!,
        totalPrice: totalPrice, // null で金額クリア(単価も自動で null に)
        isFullTank: form.isFullTank,
        // 空欄 = null で「クリア」。undefined は「変更なし」になり旧値が残るので使わない
        stationName: form.stationName.trim() || null,
        memo: form.memo.trim() || null,
      })
      showToast('変更を保存しました(影響区間の燃費を再計算)')
      navigate({ name: 'fuel-list' })
    } catch (err) {
      console.error('給油記録の更新に失敗:', err)
      showToast('保存に失敗しました。もう一度お試しください')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    try {
      await fuelRecordRepository.remove(record.id)
      setConfirmDelete(false)
      showToast('記録を削除しました')
      navigate({ name: 'fuel-list' })
    } catch (err) {
      console.error('給油記録の削除に失敗:', err)
      setConfirmDelete(false)
      showToast('削除に失敗しました。もう一度お試しください')
    }
  }

  return (
    <section className="screen">
      <ModalAppBar title="給油の詳細" icon="back" onClose={() => navigate({ name: 'fuel-list' })} />
      <div className="body-pad" style={{ gap: 12 }}>
        <div className="calc-summary">
          <div className="item">
            <div className="l">{record.fuelEconomy !== null ? '燃費(確定)' : '燃費'}</div>
            <div className="v num">
              {record.fuelEconomy !== null ? (
                <>
                  {fmtEconomy(record.fuelEconomy)} <small>km/L</small>
                </>
              ) : (
                <span style={{ color: 'var(--c-sub)', fontSize: 15 }}>
                  {/* B-2: 基準点となる満タン給油は「計算待ち」ではなく「基準」 */}
                  {record.isFullTank ? '基準' : '計算待ち'}
                </span>
              )}
            </div>
          </div>
          <div className="item">
            <div className="l">前回満タンから</div>
            <div className="v plain num">
              {distance !== null ? (
                <>
                  {fmtKm(distance)} <small>km</small>
                </>
              ) : (
                '—'
              )}
            </div>
          </div>
        </div>

        <FuelRecordFormFields
          form={form}
          setForm={(update) =>
            setForm((f) => (f === null ? f : typeof update === 'function' ? update(f) : update))
          }
          existing={others}
          previousOdo={previousOdo}
          previousUnitPrice={null}
          result={result}
          showPreview={false}
          fixedVehicle={vehicle}
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
        {missing > 0 && (
          <p className="note">あと{missing}項目(必須はODO・給油量のみ。金額は任意)</p>
        )}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="この給油記録を削除しますか?"
        body={
          <>
            {fmtDateFull(record.date)} ・ {fmtLiters(record.fuelAmount)}L ・{' '}
            {fmtYen(record.totalPrice)}
            <br />
            削除すると前後の区間の燃費が再計算されます。
          </>
        }
        confirmLabel="削除する"
        onConfirm={() => void handleDelete()}
        onCancel={() => setConfirmDelete(false)}
      />
    </section>
  )
}
