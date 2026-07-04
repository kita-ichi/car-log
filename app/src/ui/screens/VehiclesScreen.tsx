/**
 * S-08 車両管理(一覧・登録・編集)
 * - 初回起動(車両0台)はこの画面の登録フォームから開始(オンボーディング)
 * - 行タップ=選択中の車両に切り替え / 編集=フォーム展開
 * - 削除は無し。「アーカイブ(手放した)」で非表示(記録は保持)
 */
import { useEffect, useRef, useState } from 'react'
import type { FuelType, Vehicle, VehicleType } from '../../types/models'
import { vehicleRepository } from '../../db/repositories'
import { validateVehicle } from '../../logic/validation'
import { useApp } from '../AppContext'
import { ConfirmDialog, ModalAppBar } from '../components'
import { BikeIcon, CarIcon, PlusIcon, VehicleIcon } from '../icons'
import { fmtKm, fuelTypeLabel, vehicleTypeLabel } from '../format'

/** メーカー候補(デザインガイド 5.14。車両タイプに応じて切替) */
const MAKERS: Record<VehicleType, string[]> = {
  car: [
    'トヨタ',
    'ホンダ',
    '日産',
    'マツダ',
    'スバル',
    '三菱',
    'スズキ',
    'ダイハツ',
    'レクサス',
    'メルセデス・ベンツ',
    'BMW',
    'フォルクスワーゲン',
    'アウディ',
    'ボルボ',
  ],
  motorcycle: [
    'ホンダ',
    'ヤマハ',
    'スズキ',
    'カワサキ',
    'ハーレーダビッドソン',
    'BMW',
    'ドゥカティ',
    'トライアンフ',
    'KTM',
  ],
}

const OTHER_MAKER = '__other'

interface FormState {
  vehicleType: VehicleType
  name: string
  /** select の値(候補名 / '' / OTHER_MAKER) */
  makerSelect: string
  /** その他(手入力)のメーカー名 */
  makerFree: string
  model: string
  firstRegistrationYm: string
  initialOdo: string
  fuelType: FuelType
  tankCapacity: string
  inspectionExpiry: string
}

const emptyForm = (): FormState => ({
  vehicleType: 'car',
  name: '',
  makerSelect: '',
  makerFree: '',
  model: '',
  firstRegistrationYm: '',
  initialOdo: '',
  fuelType: 'regular',
  tankCapacity: '',
  inspectionExpiry: '',
})

const formFromVehicle = (v: Vehicle): FormState => {
  const inList = v.maker !== undefined && MAKERS[v.vehicleType].includes(v.maker)
  return {
    vehicleType: v.vehicleType,
    name: v.name,
    makerSelect: v.maker ? (inList ? v.maker : OTHER_MAKER) : '',
    makerFree: v.maker && !inList ? v.maker : '',
    model: v.model ?? '',
    firstRegistrationYm: v.firstRegistrationYm ?? '',
    initialOdo: String(v.initialOdo),
    fuelType: v.fuelType,
    tankCapacity: v.tankCapacity !== undefined ? String(v.tankCapacity) : '',
    inspectionExpiry: v.inspectionExpiry ?? '',
  }
}

export function VehiclesScreen({ openFormOnMount }: { openFormOnMount?: boolean }) {
  const { vehicles, selectedVehicle, selectVehicle, refreshVehicles, showToast, navigate } =
    useApp()
  const isOnboarding = vehicles.length === 0
  /** null=フォーム非表示 / 'new'=追加 / Vehicle=編集 */
  const [editing, setEditing] = useState<'new' | Vehicle | null>(
    openFormOnMount || isOnboarding ? 'new' : null,
  )
  const [form, setForm] = useState<FormState>(emptyForm())
  const [confirmArchive, setConfirmArchive] = useState(false)
  const [saving, setSaving] = useState(false)
  /** アーカイブ済み車両(B-1: 復元導線)。折りたたみ表示 */
  const [archived, setArchived] = useState<Vehicle[]>([])
  const [showArchived, setShowArchived] = useState(false)
  const formRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (editing !== null) formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [editing])

  const loadArchived = async () => {
    const all = await vehicleRepository.listAll()
    setArchived(all.filter((v) => v.isArchived))
  }

  useEffect(() => {
    void loadArchived().catch((err) => console.error('アーカイブ済み車両の読込に失敗:', err))
  }, [])

  const openForm = (target: 'new' | Vehicle) => {
    setForm(target === 'new' ? emptyForm() : formFromVehicle(target))
    setEditing(target)
  }

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  /** 車両タイプ切替: 選択済みメーカーが新候補に無ければ未選択に戻す(§S-08) */
  const pickType = (type: VehicleType) => {
    setForm((f) => {
      const keep = f.makerSelect === OTHER_MAKER || MAKERS[type].includes(f.makerSelect)
      return { ...f, vehicleType: type, makerSelect: keep ? f.makerSelect : '' }
    })
  }

  const odoValue = Number(form.initialOdo)
  // ライブバリデーション(§0.2): エラーがあれば保存無効化(負・0のタンク容量なども弾く)
  const result = validateVehicle({
    name: form.name,
    initialOdo: form.initialOdo.trim() === '' ? null : odoValue,
    tankCapacity: form.tankCapacity.trim() === '' ? null : Number(form.tankCapacity),
  })
  const canSave = result.canSave && !saving

  const handleSave = async () => {
    if (!canSave || editing === null) return
    setSaving(true)
    try {
      const maker =
        form.makerSelect === OTHER_MAKER ? form.makerFree.trim() : form.makerSelect
      // 空欄 = null: create では「未設定」、update では「クリア」として扱われる
      // (undefined だと update で「変更なし」になり旧値が残る)
      const payload = {
        vehicleType: form.vehicleType,
        name: form.name.trim(),
        maker: maker || null,
        model: form.model.trim() || null,
        firstRegistrationYm: form.firstRegistrationYm || null,
        initialOdo: odoValue,
        fuelType: form.fuelType,
        tankCapacity: form.tankCapacity !== '' ? Number(form.tankCapacity) : null,
        inspectionExpiry: form.inspectionExpiry || null,
      }
      const wasOnboarding = isOnboarding
      let saved: Vehicle
      if (editing === 'new') {
        saved = await vehicleRepository.create(payload)
      } else {
        saved = await vehicleRepository.update(editing.id, payload)
      }
      await refreshVehicles()
      setEditing(null)
      if (editing === 'new') {
        await selectVehicle(saved.id)
      }
      showToast(`${saved.name} を保存しました`)
      if (wasOnboarding) navigate({ name: 'home' }) // 初回登録後はホームへ
    } catch (err) {
      console.error('車両の保存に失敗:', err)
      showToast('保存に失敗しました。もう一度お試しください')
    } finally {
      setSaving(false)
    }
  }

  const handleArchive = async () => {
    if (editing === null || editing === 'new') return
    try {
      await vehicleRepository.archive(editing.id)
      setConfirmArchive(false)
      setEditing(null)
      await refreshVehicles()
      showToast(`${editing.name} をアーカイブしました(記録は保持されます)`)
    } catch (err) {
      console.error('車両のアーカイブに失敗:', err)
      setConfirmArchive(false)
      showToast('アーカイブに失敗しました。もう一度お試しください')
    }
    await loadArchived().catch(() => {})
  }

  /** アーカイブ済み車両を一覧に復元する(B-1) */
  const handleRestore = async (v: Vehicle) => {
    const wasOnboarding = isOnboarding
    try {
      await vehicleRepository.unarchive(v.id)
      const list = await refreshVehicles()
      await loadArchived()
      showToast(`${v.name} を復元しました`)
      // 全車両アーカイブ→オンボーディング中の復元: そのまま利用再開できるようホームへ
      if (wasOnboarding && list.length > 0) {
        await selectVehicle(v.id)
        navigate({ name: 'home' })
      }
    } catch (err) {
      console.error('車両の復元に失敗:', err)
      showToast('復元に失敗しました。もう一度お試しください')
    }
  }

  const handleRowTap = async (v: Vehicle) => {
    if (v.id === selectedVehicle?.id) return
    await selectVehicle(v.id)
    showToast(`${v.name} に切り替えました`)
  }

  /** アーカイブ済みセクション(折りたたみ)。通常時は一覧の下、オンボーディング時は案内の下に出す */
  const archivedSection = archived.length > 0 && (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <button
        className="link"
        style={{ textAlign: 'left', margin: '0 4px' }}
        aria-expanded={showArchived}
        onClick={() => setShowArchived((s) => !s)}
      >
        アーカイブ済みの車両({archived.length}台){showArchived ? 'を隠す ▲' : 'を表示 ▼'}
      </button>
      {showArchived && (
        <>
          <div className="list">
            {archived.map((v) => (
              <div key={v.id} className="row static">
                <span style={{ color: 'var(--c-sub)', display: 'flex' }}>
                  <VehicleIcon type={v.vehicleType} size={24} />
                </span>
                <div className="grow">
                  <div style={{ fontWeight: 700 }}>{v.name}</div>
                  <div className="sub num">
                    {[vehicleTypeLabel(v.vehicleType), [v.maker, v.model].filter(Boolean).join(' ')]
                      .filter(Boolean)
                      .join(' ・ ')}
                  </div>
                </div>
                <button className="link" onClick={() => void handleRestore(v)}>
                  復元
                </button>
              </div>
            ))}
          </div>
          <p className="sub" style={{ margin: '0 4px' }}>
            復元すると車両一覧に戻ります。給油・メンテの記録はアーカイブ中も保持されています。
          </p>
        </>
      )}
    </div>
  )

  return (
    <section className="screen">
      {isOnboarding ? (
        <header className="appbar">
          <span className="title">ようこそ! 車両を登録しましょう</span>
        </header>
      ) : (
        <ModalAppBar title="車両管理" icon="back" onClose={() => navigate({ name: 'settings' })} />
      )}

      <div className="body-pad" style={{ gap: 12 }}>
        {isOnboarding ? (
          <>
            <p className="sub" style={{ margin: '0 4px' }}>
              最初に車両(車・バイク)を1台登録してください。登録後すぐに給油の記録を始められます。
            </p>
            {archivedSection}
          </>
        ) : (
          <>
            <div className="list">
              {/* B-6: 行(切り替え)と編集は別のインタラクティブ要素に分離(ボタン内ネスト禁止・キーボード到達可能) */}
              {vehicles.map((v) => (
                <div key={v.id} className="row split">
                  <button
                    className="row-main"
                    onClick={() => void handleRowTap(v)}
                    aria-label={`${v.name} に切り替え`}
                  >
                    <span style={{ color: 'var(--c-sub)', display: 'flex' }}>
                      <VehicleIcon type={v.vehicleType} size={24} />
                    </span>
                    <div className="grow">
                      <div style={{ fontWeight: 700 }}>
                        {v.name}{' '}
                        {v.id === selectedVehicle?.id && <span className="badge sel">選択中</span>}
                      </div>
                      <div className="sub num">
                        {[
                          vehicleTypeLabel(v.vehicleType),
                          [v.maker, v.model].filter(Boolean).join(' '),
                          `ODO ${fmtKm(v.initialOdo)} km〜`,
                          fuelTypeLabel(v.fuelType),
                        ]
                          .filter(Boolean)
                          .join(' ・ ')}
                      </div>
                    </div>
                  </button>
                  <button
                    className="link row-edit"
                    onClick={() => openForm(v)}
                    aria-label={`${v.name} を編集`}
                  >
                    編集
                  </button>
                </div>
              ))}
            </div>
            <p className="sub" style={{ margin: '0 4px' }}>
              行をタップすると選択中の車両に切り替わります。
            </p>
            <button className="btn secondary" onClick={() => openForm('new')}>
              <PlusIcon size={20} />
              車両を追加
            </button>
            {archivedSection}
          </>
        )}

        {editing !== null && (
          <div ref={formRef} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h2 className="card-h" style={{ margin: '8px 4px 0' }}>
              {editing === 'new' ? '車両の登録' : '車両の編集'}
            </h2>

            <div className="field">
              <label>
                車両タイプ <span className="req">*</span>
              </label>
              <div className="seg">
                <button
                  type="button"
                  className={form.vehicleType === 'car' ? 'active' : ''}
                  onClick={() => pickType('car')}
                >
                  <CarIcon size={20} />車
                </button>
                <button
                  type="button"
                  className={form.vehicleType === 'motorcycle' ? 'active' : ''}
                  onClick={() => pickType('motorcycle')}
                >
                  <BikeIcon size={20} />
                  バイク
                </button>
              </div>
              <div className="hint">タイプに応じてメーカーの候補が切り替わります</div>
            </div>

            <div className="field">
              <label htmlFor="v-name">
                車両名 <span className="req">*</span>
              </label>
              <input
                id="v-name"
                type="text"
                className="txt"
                placeholder="例: ノート"
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="v-maker">
                メーカー <span className="opt">任意</span>
              </label>
              <select
                id="v-maker"
                value={form.makerSelect}
                onChange={(e) => set('makerSelect', e.target.value)}
              >
                <option value="">選択してください</option>
                {MAKERS[form.vehicleType].map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
                <option value={OTHER_MAKER}>その他(手入力)</option>
              </select>
            </div>
            {form.makerSelect === OTHER_MAKER && (
              <div className="field">
                <label htmlFor="v-maker-free">メーカー名を入力</label>
                <input
                  id="v-maker-free"
                  type="text"
                  className="txt"
                  placeholder="例: テスラ、ロータス など"
                  value={form.makerFree}
                  onChange={(e) => set('makerFree', e.target.value)}
                />
              </div>
            )}

            <div className="field">
              <label htmlFor="v-model">
                型式・グレード <span className="opt">任意</span>
              </label>
              <input
                id="v-model"
                type="text"
                className="txt"
                placeholder="例: E13"
                value={form.model}
                onChange={(e) => set('model', e.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="v-firstreg">
                初度登録年月 <span className="opt">任意</span>
              </label>
              <input
                id="v-firstreg"
                type="month"
                value={form.firstRegistrationYm}
                onChange={(e) => set('firstRegistrationYm', e.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="v-odo">
                登録時ODO <span className="req">*</span>
              </label>
              <div className="inrow">
                <input
                  id="v-odo"
                  type="number"
                  inputMode="numeric"
                  className="num-lg"
                  placeholder="0"
                  value={form.initialOdo}
                  onChange={(e) => set('initialOdo', e.target.value)}
                />
                <span className="unit">km</span>
              </div>
              <div className="hint">ODOの入力チェック(逆行警告)の基準になります</div>
            </div>

            <div className="field">
              <label htmlFor="v-fuel">
                燃料種別 <span className="req">*</span>
              </label>
              <select
                id="v-fuel"
                value={form.fuelType}
                onChange={(e) => set('fuelType', e.target.value as FuelType)}
              >
                <option value="regular">レギュラー</option>
                <option value="premium">ハイオク</option>
                <option value="diesel">軽油</option>
              </select>
            </div>

            <div className="field">
              <label htmlFor="v-tank">
                タンク容量 <span className="opt">任意</span>
              </label>
              <div className="inrow">
                <input
                  id="v-tank"
                  type="number"
                  inputMode="decimal"
                  className="num-lg"
                  placeholder="—"
                  value={form.tankCapacity}
                  onChange={(e) => set('tankCapacity', e.target.value)}
                />
                <span className="unit">L</span>
              </div>
              {result.errors.some((e) => e.field === 'tankCapacity') ? (
                <div className="hint" style={{ color: 'var(--c-danger)' }}>
                  {result.errors.find((e) => e.field === 'tankCapacity')?.message}
                </div>
              ) : (
                <div className="hint">給油量の入力チェックに使われます</div>
              )}
            </div>

            <div className="field">
              <label htmlFor="v-inspection">
                車検満了日 <span className="opt">任意</span>
              </label>
              <input
                id="v-inspection"
                type="date"
                value={form.inspectionExpiry}
                onChange={(e) => set('inspectionExpiry', e.target.value)}
              />
            </div>

            <button className="btn primary" disabled={!canSave} onClick={() => void handleSave()}>
              保存する
            </button>
            {!result.canSave && (
              <p className="sub" style={{ margin: '0 4px', textAlign: 'center' }}>
                {result.errors[0]?.message}
              </p>
            )}
            {editing !== 'new' && (
              <button className="btn danger-text" onClick={() => setConfirmArchive(true)}>
                この車両をアーカイブ(手放した)
              </button>
            )}
            {!isOnboarding && (
              <button className="btn ghost" onClick={() => setEditing(null)}>
                キャンセル
              </button>
            )}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmArchive}
        title="この車両をアーカイブしますか?"
        body="一覧から非表示になります。給油・メンテの記録は保持されます。"
        confirmLabel="アーカイブ"
        onConfirm={() => void handleArchive()}
        onCancel={() => setConfirmArchive(false)}
      />
    </section>
  )
}
