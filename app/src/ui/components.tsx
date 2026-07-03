/**
 * 共通コンポーネント(デザインガイド §5)
 * - 車両チップ付きアプリバー / モーダル用アプリバー
 * - タブバー / FAB / トースト
 * - 車両切り替えボトムシート(S-11)
 * - 確認ダイアログ / 満タントグル / 警告チップ
 */
import { useEffect, useState } from 'react'
import type { FuelRecord, Vehicle } from '../types/models'
import { fuelRecordRepository } from '../db/repositories'
import { isModalRoute, routeTab, useApp, type Route, type TabName } from './AppContext'
import {
  BackIcon,
  CheckIcon,
  ChevronDownIcon,
  CloseIcon,
  FuelIcon,
  HomeIcon,
  PlusIcon,
  SettingsIcon,
  VehicleIcon,
  WrenchIcon,
} from './icons'
import { fmtKm } from './format'
import type { ValidationIssue } from '../logic/validation'

/* ============ アプリバー ============ */

/** 車両チップ(5.1)。タップで車両切り替えシートを開く */
export function VehicleChip() {
  const { selectedVehicle, openVehicleSheet } = useApp()
  return (
    <button className="vchip" onClick={openVehicleSheet} aria-label="車両を切り替え">
      <VehicleIcon type={selectedVehicle?.vehicleType ?? 'car'} size={20} />
      <span className="nm">{selectedVehicle?.name ?? '車両未登録'}</span>
      <ChevronDownIcon size={16} />
    </button>
  )
}

/** 一覧・ホーム系のアプリバー(車両チップ+右側要素) */
export function ListAppBar({
  title,
  right,
}: {
  title?: string
  right?: React.ReactNode
}) {
  return (
    <header className="appbar">
      <VehicleChip />
      {title ? (
        <span className="title right num">{title}</span>
      ) : (
        <span style={{ flex: 1 }} />
      )}
      {right}
    </header>
  )
}

/** 入力・詳細系のアプリバー(✕ or ← +タイトル) */
export function ModalAppBar({
  title,
  onClose,
  icon = 'close',
}: {
  title: string
  onClose: () => void
  icon?: 'close' | 'back'
}) {
  return (
    <header className="appbar">
      <button
        className="iconbtn"
        onClick={onClose}
        aria-label={icon === 'close' ? 'キャンセル' : '戻る'}
      >
        {icon === 'close' ? <CloseIcon /> : <BackIcon />}
      </button>
      <span className="title">{title}</span>
    </header>
  )
}

/* ============ タブバー(5.2) ============ */

const TABS: { tab: TabName; label: string; route: Route; icon: React.ReactNode }[] = [
  { tab: 'home', label: 'ホーム', route: { name: 'home' }, icon: <HomeIcon /> },
  { tab: 'fuel', label: '給油', route: { name: 'fuel-list' }, icon: <FuelIcon /> },
  { tab: 'maint', label: 'メンテ', route: { name: 'maint-list' }, icon: <WrenchIcon /> },
  { tab: 'settings', label: '設定', route: { name: 'settings' }, icon: <SettingsIcon /> },
]

export function TabBar() {
  const { route, navigate } = useApp()
  if (isModalRoute(route)) return null
  const active = routeTab(route)
  return (
    <nav className="tabbar">
      {TABS.map(({ tab, label, route: target, icon }) => (
        <button
          key={tab}
          className={`tab${active === tab ? ' active' : ''}`}
          onClick={() => navigate(target)}
        >
          {icon}
          {label}
        </button>
      ))}
    </nav>
  )
}

/* ============ FAB(5.7) ============ */

export function Fab({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button className="fab" onClick={onClick} aria-label={label}>
      <PlusIcon size={26} />
    </button>
  )
}

/* ============ トースト(5.11) ============ */

export function Toast() {
  const { toast } = useApp()
  return (
    <div className={`toast${toast.visible ? ' show' : ''}`} role="status">
      {toast.message}
    </div>
  )
}

/* ============ 車両切り替えボトムシート(S-11 / 5.8) ============ */

export function VehicleSheet() {
  const {
    vehicles,
    selectedVehicle,
    selectVehicle,
    vehicleSheetOpen,
    closeVehicleSheet,
    showToast,
    navigate,
  } = useApp()
  // 補足表示用: 各車両の最新給油記録(最新ODO)
  const [latestMap, setLatestMap] = useState<Map<string, FuelRecord>>(new Map())

  useEffect(() => {
    if (!vehicleSheetOpen) return
    let cancelled = false
    void (async () => {
      const entries = await Promise.all(
        vehicles.map(async (v) => [v.id, await fuelRecordRepository.latestByVehicle(v.id)] as const),
      )
      if (cancelled) return
      const map = new Map<string, FuelRecord>()
      for (const [id, rec] of entries) if (rec) map.set(id, rec)
      setLatestMap(map)
    })()
    return () => {
      cancelled = true
    }
  }, [vehicleSheetOpen, vehicles])

  if (!vehicleSheetOpen) return null

  const describe = (v: Vehicle): string => {
    const latest = latestMap.get(v.id)
    const odo = latest ? latest.odo : v.initialOdo
    return [v.maker, `ODO ${fmtKm(odo)} km`].filter(Boolean).join(' ・ ')
  }

  const handleSelect = async (v: Vehicle) => {
    const changed = v.id !== selectedVehicle?.id
    await selectVehicle(v.id)
    closeVehicleSheet()
    if (changed) showToast(`${v.name} に切り替えました`)
  }

  return (
    <div
      className="overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeVehicleSheet()
      }}
    >
      <div className="sheet" role="dialog" aria-label="車両を切り替え">
        <div className="grab" />
        <h3>車両を切り替え</h3>
        {vehicles.map((v) => (
          <button
            key={v.id}
            className={`vrow${v.id === selectedVehicle?.id ? ' on' : ''}`}
            onClick={() => void handleSelect(v)}
          >
            <VehicleIcon type={v.vehicleType} size={24} />
            <span className="grow">
              {v.name}
              <br />
              <span className="sub num">{describe(v)}</span>
            </span>
            <span className="check">
              <CheckIcon size={24} />
            </span>
          </button>
        ))}
        <button
          className="vrow add"
          onClick={() => {
            closeVehicleSheet()
            navigate({ name: 'vehicles', openForm: true })
          }}
        >
          <PlusIcon size={24} />
          <span className="grow">車両を追加</span>
        </button>
      </div>
    </div>
  )
}

/* ============ 確認ダイアログ(5.11: キャンセル左・削除右) ============ */

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  body: React.ReactNode
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}) {
  if (!open) return null
  return (
    <div
      className="overlay center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div className="dialog" role="alertdialog" aria-label={title}>
        <h3>{title}</h3>
        <p className="num">{body}</p>
        <div className="acts">
          <button className="btn ghost" onClick={onCancel}>
            キャンセル
          </button>
          <button className="btn dngr" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ============ 対象車両行(入力画面の先頭。タップでS-11) ============ */

export function TargetVehicleRow() {
  const { selectedVehicle, openVehicleSheet } = useApp()
  return (
    <button className="target-vehicle" onClick={openVehicleSheet}>
      <span className="ticon">
        <VehicleIcon type={selectedVehicle?.vehicleType ?? 'car'} size={22} />
      </span>
      <span className="grow">
        <span className="lbl">対象車両</span>
        <br />
        <span className="nm">{selectedVehicle?.name ?? '—'}</span>
      </span>
      <ChevronDownIcon size={20} className="chev" />
    </button>
  )
}

/* ============ 満タントグル(5.5) ============ */

export function FullTankSwitch({
  checked,
  onChange,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <div className="switchrow">
      <div className="grow">
        <div className="t">満タン</div>
        <div className="sub">
          {checked
            ? '満タン給油ごとに燃費が確定します'
            : 'OFF: 燃費は次の満タン給油時にまとめて計算されます'}
        </div>
      </div>
      <span className="switch">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          aria-label="満タン"
        />
        <span className="knob" />
      </span>
    </div>
  )
}

/* ============ 警告チップ(§0.2: アンバー・保存はブロックしない) ============ */

/** 指定フィールドの警告チップ群(該当欄の直下に置く) */
export function WarnChips({ warnings, field }: { warnings: ValidationIssue[]; field: string }) {
  const hits = warnings.filter((w) => w.field === field)
  if (hits.length === 0) return null
  return (
    <>
      {hits.map((w) => (
        <div key={w.code} className="warnchip num">
          {w.message}
        </div>
      ))}
    </>
  )
}
