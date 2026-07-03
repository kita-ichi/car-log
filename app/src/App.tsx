/**
 * アプリシェル: 画面ルーティング(自前・軽量)+ 共通UI(タブバー・トースト・車両切替シート)
 * 画面対応: docs/design/画面設計書.md(S-01〜S-09、S-11)
 */
import { AppProvider, useApp } from './ui/AppContext'
import { TabBar, Toast, VehicleSheet } from './ui/components'
import { HomeScreen } from './ui/screens/HomeScreen'
import { FuelDetailScreen, FuelNewScreen } from './ui/screens/FuelFormScreens'
import { FuelHistoryScreen } from './ui/screens/FuelHistoryScreen'
import { MaintDetailScreen, MaintHistoryScreen, MaintNewScreen } from './ui/screens/MaintScreens'
import { GraphScreen } from './ui/screens/GraphScreen'
import { VehiclesScreen } from './ui/screens/VehiclesScreen'
import { SettingsScreen } from './ui/screens/SettingsScreen'

function CurrentScreen() {
  const { route, ready, vehicles } = useApp()
  if (!ready) return null

  // オンボーディング: 車両0台の間は車両登録(S-08)に固定
  if (vehicles.length === 0) return <VehiclesScreen openFormOnMount />

  switch (route.name) {
    case 'home':
      return <HomeScreen />
    case 'fuel-new':
      return <FuelNewScreen />
    case 'fuel-list':
      return <FuelHistoryScreen />
    case 'fuel-detail':
      return <FuelDetailScreen id={route.id} key={route.id} />
    case 'maint-new':
      return <MaintNewScreen />
    case 'maint-list':
      return <MaintHistoryScreen />
    case 'maint-detail':
      return <MaintDetailScreen id={route.id} key={route.id} />
    case 'graph':
      return <GraphScreen />
    case 'vehicles':
      return <VehiclesScreen openFormOnMount={route.openForm} />
    case 'settings':
      return <SettingsScreen />
  }
}

function Shell() {
  const { route } = useApp()
  return (
    <div className="app">
      {/* key でルートごとに main を作り直し、スクロール位置をリセットする */}
      <main className="app-main" key={JSON.stringify(route)}>
        <CurrentScreen />
      </main>
      <TabBar />
      <VehicleSheet />
      <Toast />
    </div>
  )
}

function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  )
}

export default App
