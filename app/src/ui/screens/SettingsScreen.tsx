/**
 * S-09 設定・データ管理
 * - 車両管理への導線(登録台数・選択中車両名)
 * - バックアップ: JSON/CSVエクスポートは「準備中」表示(F-11 は次タスクで backend-developer が実装)
 * - データインポート / リマインダー設定: フェーズ2(グレーアウト)
 */
import { useApp } from '../AppContext'
import { ChevronRightIcon, DownloadIcon } from '../icons'

const APP_VERSION = '0.1.0 (MVP)'

export function SettingsScreen() {
  const { vehicles, selectedVehicle, navigate, showToast } = useApp()

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
            <button
              className="row"
              onClick={() => showToast('JSONエクスポートは準備中です(次のアップデートで提供予定)')}
            >
              <div className="grow">
                <div style={{ fontWeight: 700 }}>
                  JSONエクスポート <span className="badge wait">準備中</span>
                </div>
                <div className="sub">全データの完全バックアップ(インポート用)</div>
              </div>
              <span className="chev" style={{ display: 'flex' }}>
                <DownloadIcon size={18} />
              </span>
            </button>
            <button
              className="row"
              onClick={() => showToast('CSVエクスポートは準備中です(次のアップデートで提供予定)')}
            >
              <div className="grow">
                <div style={{ fontWeight: 700 }}>
                  CSVエクスポート <span className="badge wait">準備中</span>
                </div>
                <div className="sub">表計算ソフトで開ける形式</div>
              </div>
              <span className="chev" style={{ display: 'flex' }}>
                <DownloadIcon size={18} />
              </span>
            </button>
            <div className="row static disabled-row">
              <div className="grow">
                <div style={{ fontWeight: 700 }}>データインポート</div>
                <div className="sub">フェーズ2で提供予定</div>
              </div>
            </div>
          </div>
          <p className="setrow-note" style={{ paddingTop: 8 }}>
            データはこの端末の中だけに保存されています。機種変更や端末故障に備えて、エクスポート機能の提供後は定期的なバックアップをおすすめします。
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
