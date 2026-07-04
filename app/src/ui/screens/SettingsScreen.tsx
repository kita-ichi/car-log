/**
 * S-09 設定・データ管理
 * - 車両管理への導線(登録台数・選択中車両名)
 * - バックアップ: JSONバックアップ / 給油記録CSV / メンテ記録CSV のエクスポート(F-11)。
 *   注記に最終バックアップ日を表示(JSONバックアップ時に記録)
 * - データインポート / リマインダー設定: フェーズ2(グレーアウト)
 */
import { useEffect, useState } from 'react'
import { exportService, type ExportPayload } from '../../db/exportService'
import { localDateString } from '../../logic/export'
import { settingsRepository } from '../../db/repositories'
import { useApp } from '../AppContext'
import { downloadTextFile } from '../download'
import { fmtDateFull } from '../format'
import { ChevronRightIcon, DownloadIcon } from '../icons'

const APP_VERSION = '0.1.0 (MVP)'

/** エクスポート行(F-11)。DownloadIcon 付きのボタン */
function ExportRow(props: { title: string; sub: string; onClick: () => void; disabled: boolean }) {
  return (
    <button className="row" onClick={props.onClick} disabled={props.disabled}>
      <div className="grow">
        <div style={{ fontWeight: 700 }}>{props.title}</div>
        <div className="sub">{props.sub}</div>
      </div>
      <span className="chev" style={{ display: 'flex' }}>
        <DownloadIcon size={18} />
      </span>
    </button>
  )
}

export function SettingsScreen() {
  const { vehicles, selectedVehicle, navigate, showToast } = useApp()
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  // 最終バックアップ日時の復元(表示用)
  useEffect(() => {
    settingsRepository
      .getLastBackupAt()
      .then(setLastBackupAt)
      .catch((err) => console.error('最終バックアップ日時の読込に失敗:', err))
  }, [])

  /** エクスポート共通フロー: 生成 → ダウンロード → トースト(失敗時はエラートースト) */
  const runExport = async (
    build: () => Promise<ExportPayload>,
    successMessage: string,
    isBackup: boolean,
  ) => {
    if (exporting) return
    setExporting(true)
    try {
      const payload = await build()
      downloadTextFile(payload)
      if (isBackup) setLastBackupAt(new Date().toISOString())
      showToast(successMessage)
    } catch (err) {
      console.error('エクスポートに失敗:', err)
      showToast('エクスポートに失敗しました。もう一度お試しください')
    } finally {
      setExporting(false)
    }
  }

  return (
    <section className="screen">
      <header className="appbar">
        <span className="title">設定・データ管理</span>
      </header>

      <div className="body-pad" style={{ gap: 16 }}>
        <div>
          <h2 className="card-h" style={{ margin: '0 4px 8px' }}>
            車両
          </h2>
          <div className="list">
            <button className="row" onClick={() => navigate({ name: 'vehicles' })}>
              <div className="grow">
                <div style={{ fontWeight: 700 }}>車両管理</div>
                <div className="sub num">
                  登録{vehicles.length}台 ・ 選択中: {selectedVehicle?.name ?? '—'}
                </div>
              </div>
              <ChevronRightIcon size={18} className="chev" />
            </button>
          </div>
        </div>

        <div>
          <h2 className="card-h" style={{ margin: '0 4px 8px' }}>
            バックアップ
          </h2>
          <div className="list">
            <ExportRow
              title="JSONバックアップを書き出す"
              sub="全データの完全バックアップ(インポート用)"
              disabled={exporting}
              onClick={() =>
                void runExport(
                  () => exportService.exportBackupJson(),
                  'JSONバックアップを書き出しました',
                  true,
                )
              }
            />
            <ExportRow
              title="給油記録CSV"
              sub="表計算ソフトで開ける形式(全車両)"
              disabled={exporting}
              onClick={() =>
                void runExport(() => exportService.exportFuelCsv(), '給油記録CSVを書き出しました', false)
              }
            />
            <ExportRow
              title="メンテ記録CSV"
              sub="表計算ソフトで開ける形式(全車両)"
              disabled={exporting}
              onClick={() =>
                void runExport(
                  () => exportService.exportMaintenanceCsv(),
                  'メンテ記録CSVを書き出しました',
                  false,
                )
              }
            />
            <div className="row static disabled-row">
              <div className="grow">
                <div style={{ fontWeight: 700 }}>データインポート</div>
                <div className="sub">フェーズ2で提供予定</div>
              </div>
            </div>
          </div>
          <p className="setrow-note" style={{ paddingTop: 8 }}>
            データはこの端末の中だけに保存されています。機種変更や端末故障に備えて、定期的なバックアップをおすすめします(最終バックアップ:{' '}
            {lastBackupAt ? fmtDateFull(localDateString(new Date(lastBackupAt))) : 'まだありません'})。
          </p>
        </div>

        <div>
          <h2 className="card-h" style={{ margin: '0 4px 8px' }}>
            リマインダー
          </h2>
          <div className="list">
            <div className="row static disabled-row">
              <div className="grow">
                <div style={{ fontWeight: 700 }}>リマインダー設定</div>
                <div className="sub">フェーズ2で提供予定(オイル交換 5,000km/6ヶ月 など)</div>
              </div>
            </div>
          </div>
        </div>

        <div>
          <h2 className="card-h" style={{ margin: '0 4px 8px' }}>
            アプリ情報
          </h2>
          <div className="list">
            <div className="row static">
              <div className="grow">
                <div style={{ fontWeight: 700 }}>バージョン</div>
              </div>
              <span className="sub num">{APP_VERSION}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
