/**
 * アプリ全体の状態管理:
 * - 軽量ルーティング(自前。URL同期なしの画面スタック最小実装)
 * - 車両一覧・選択中車両(settingsRepository で永続化 — S-11)
 * - トースト / 車両切り替えシートの開閉
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { Vehicle } from '../types/models'
import { settingsRepository, vehicleRepository } from '../db/repositories'

/** 画面定義(docs/design/画面設計書.md の S-xx に対応) */
export type Route =
  | { name: 'home' } // S-01
  | { name: 'fuel-new' } // S-02
  | { name: 'fuel-list' } // S-03
  | { name: 'fuel-detail'; id: string } // S-04
  | { name: 'maint-new' } // S-05
  | { name: 'maint-list' } // S-06
  | { name: 'maint-detail'; id: string } // S-06 詳細・編集
  | { name: 'graph' } // S-07
  | { name: 'vehicles'; openForm?: boolean } // S-08
  | { name: 'settings' } // S-09

export type TabName = 'home' | 'fuel' | 'maint' | 'settings'

/** タブ対応(§0.1): ホーム=S-01 / 給油=S-03 / メンテ=S-06 / 設定=S-09 */
export const routeTab = (route: Route): TabName => {
  switch (route.name) {
    case 'home':
      return 'home'
    case 'fuel-new':
    case 'fuel-list':
    case 'fuel-detail':
    case 'graph':
      return 'fuel'
    case 'maint-new':
    case 'maint-list':
    case 'maint-detail':
      return 'maint'
    case 'vehicles':
    case 'settings':
      return 'settings'
  }
}

/** 入力・詳細画面はタブバー非表示のモーダル扱い(§0.1) */
export const isModalRoute = (route: Route): boolean =>
  route.name === 'fuel-new' ||
  route.name === 'fuel-detail' ||
  route.name === 'maint-new' ||
  route.name === 'maint-detail'

interface AppContextValue {
  /** 初期ロード(車両・選択状態の復元)完了か */
  ready: boolean
  /** 起動時のDBオープン・読込に失敗したか(true ならエラー画面を表示) */
  initError: boolean
  route: Route
  navigate: (route: Route) => void
  vehicles: Vehicle[]
  selectedVehicle: Vehicle | null
  /** 車両を切り替えて永続化する(S-11)。戻り値: 切り替え後の車両 */
  selectVehicle: (id: string) => Promise<Vehicle | null>
  /** 車両の追加・編集・アーカイブ後に一覧を再読込する */
  refreshVehicles: () => Promise<Vehicle[]>
  showToast: (message: string) => void
  toast: { message: string; visible: boolean }
  vehicleSheetOpen: boolean
  openVehicleSheet: () => void
  closeVehicleSheet: () => void
}

const AppContext = createContext<AppContextValue | null>(null)

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false)
  const [initError, setInitError] = useState(false)
  const [route, setRoute] = useState<Route>({ name: 'home' })
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null)
  const [toast, setToast] = useState({ message: '', visible: false })
  const [vehicleSheetOpen, setVehicleSheetOpen] = useState(false)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 起動時: 車両一覧と選択中車両を復元。車両0台なら車両登録(S-08)から開始(オンボーディング)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [list, savedId] = await Promise.all([
          vehicleRepository.listActive(),
          settingsRepository.getSelectedVehicleId(),
        ])
        if (cancelled) return
        setVehicles(list)
        if (list.length === 0) {
          setRoute({ name: 'vehicles', openForm: true })
        } else {
          const valid = savedId !== null && list.some((v) => v.id === savedId)
          const id = valid ? savedId : list[0].id
          setSelectedVehicleId(id)
          if (!valid) void settingsRepository.setSelectedVehicleId(id)
        }
        setReady(true)
      } catch (err) {
        // IndexedDB が開けない(プライベートモード等)と reject する。白画面のまま
        // にせずエラー画面(App.tsx)へフォールバックする
        console.error('起動時のデータ読込に失敗:', err)
        if (!cancelled) setInitError(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const navigate = useCallback((next: Route) => {
    setRoute(next)
  }, [])

  const refreshVehicles = useCallback(async (): Promise<Vehicle[]> => {
    const list = await vehicleRepository.listActive()
    setVehicles(list)
    // 選択中車両がアーカイブ等で消えた場合は先頭車両へフォールバック
    setSelectedVehicleId((current) => {
      if (current !== null && list.some((v) => v.id === current)) return current
      const fallback = list[0]?.id ?? null
      void settingsRepository.setSelectedVehicleId(fallback)
      return fallback
    })
    return list
  }, [])

  const selectVehicle = useCallback(
    async (id: string): Promise<Vehicle | null> => {
      setSelectedVehicleId(id)
      await settingsRepository.setSelectedVehicleId(id)
      const vehicle = vehicles.find((v) => v.id === id) ?? (await vehicleRepository.getById(id)) ?? null
      return vehicle
    },
    [vehicles],
  )

  const showToast = useCallback((message: string) => {
    setToast({ message, visible: true })
    if (toastTimer.current !== null) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => {
      setToast((t) => ({ ...t, visible: false }))
    }, 2200)
  }, [])

  const openVehicleSheet = useCallback(() => setVehicleSheetOpen(true), [])
  const closeVehicleSheet = useCallback(() => setVehicleSheetOpen(false), [])

  const selectedVehicle = useMemo(
    () => vehicles.find((v) => v.id === selectedVehicleId) ?? null,
    [vehicles, selectedVehicleId],
  )

  const value = useMemo<AppContextValue>(
    () => ({
      ready,
      initError,
      route,
      navigate,
      vehicles,
      selectedVehicle,
      selectVehicle,
      refreshVehicles,
      showToast,
      toast,
      vehicleSheetOpen,
      openVehicleSheet,
      closeVehicleSheet,
    }),
    [
      ready,
      initError,
      route,
      navigate,
      vehicles,
      selectedVehicle,
      selectVehicle,
      refreshVehicles,
      showToast,
      toast,
      vehicleSheetOpen,
      openVehicleSheet,
      closeVehicleSheet,
    ],
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp は AppProvider の内側で使用してください')
  return ctx
}
