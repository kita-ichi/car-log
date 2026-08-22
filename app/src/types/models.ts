/**
 * データモデル型定義
 * 参照: docs/要件定義書.md §5 データ項目定義
 *
 * - 日付は 'YYYY-MM-DD'、年月は 'YYYY-MM'、日時は ISO 8601 文字列で保持する
 *   (IndexedDB との相性・ソートの単純さを優先。文字列比較 = 時系列比較が成立する)
 */

/** 車両タイプ(§5.1 vehicleType) */
export type VehicleType = 'car' | 'motorcycle'

/** 燃料種別(§5.1 fuelType): レギュラー / ハイオク / 軽油 */
export type FuelType = 'regular' | 'premium' | 'diesel'

/** メンテナンス種別(§5.3 type) */
export type MaintenanceType =
  | 'oil_change'
  | 'oil_filter'
  | 'tire_change'
  | 'tire_rotation'
  | 'shaken'
  | 'legal_inspection'
  | 'battery'
  | 'wiper'
  | 'other'

/** 全レコード共通フィールド(§5 冒頭) */
export interface BaseEntity {
  /** UUID */
  id: string
  /** 作成日時(ISO 8601) */
  createdAt: string
  /** 更新日時(ISO 8601) */
  updatedAt: string
}

/** 車両(§5.1) */
export interface Vehicle extends BaseEntity {
  /** car(車)/ motorcycle(バイク)。初期値: car */
  vehicleType: VehicleType
  /** 表示名(例: ノート、ジムニー、CB400) */
  name: string
  /** メーカー(プルダウン+手入力の結果を文字列で保存) */
  maker?: string
  /** 車種・型式 */
  model?: string
  /** 初度登録年月 'YYYY-MM' */
  firstRegistrationYm?: string
  /**
   * 登録時点のODO(km)。任意 — 燃費計算には不使用。
   * 設定時はODO入力チェック(逆行警告)・前回値ヒントの基準(最初の給油まで)。
   * 未設定の場合は基準なし = 最初の給油では逆行警告を出さない
   */
  initialOdo?: number
  /** 燃料種別。初期値: regular */
  fuelType: FuelType
  /** タンク容量(L)。給油量の入力チェックに利用 */
  tankCapacity?: number
  /** 車検満了日 'YYYY-MM-DD' */
  inspectionExpiry?: string
  /**
   * 愛車の写真(F-22)の最終更新日時(ISO 8601)。
   * **画像本体はここに持たない**(別テーブル `vehiclePhotos`。§ VehiclePhoto 参照)。
   * - 値があること = 写真が設定されていること。未設定なら写真なし
   * - 値が変わったら画像が差し替わったということ。UI の ObjectURL キャッシュの
   *   無効化キーに使える(vehicleRepository が自動で維持する。手で書き換えない)
   */
  photoUpdatedAt?: string
  /** 手放した車両の非表示用(削除ではなくアーカイブ。記録は保持) */
  isArchived: boolean
}

/**
 * 愛車の写真(F-22)。車両1台につき1枚、`vehicleId` を主キーに 1:1 で持つ。
 *
 * **Vehicle 本体と別テーブルにしている理由**:
 * 車両一覧(`listActive()`)は画面表示のたびに全車両行を読むため、そこに数百KBの
 * 画像を同居させると一覧のたびに全画像をメモリに載せることになる。写真は
 * 「表示する画面が必要になったときだけ」`getPhoto()` で読む。
 *
 * 画像は保存前に長辺 1280px の JPEG へ縮小・再エンコード済み(logic/image.ts)。
 */
export interface VehiclePhoto {
  /** 対象車両ID(主キー。Vehicle と 1:1) */
  vehicleId: string
  /** 画像本体。Dexie(IndexedDB)は Blob をそのまま保存できる */
  blob: Blob
  /** 画像の MIME タイプ(通常 'image/jpeg') */
  mimeType: string
  /** バイト数(blob.size と同じ。集計・表示用に非同期読み出し無しで使えるよう持つ) */
  byteSize: number
  /** 保存されている画像の幅(px)。取得できなかった場合は未設定 */
  width?: number
  /** 保存されている画像の高さ(px)。取得できなかった場合は未設定 */
  height?: number
  /** 設定・差し替えの日時(ISO 8601。Vehicle.photoUpdatedAt と一致する) */
  updatedAt: string
}

/** 給油記録(§5.2) */
export interface FuelRecord extends BaseEntity {
  vehicleId: string
  /** 給油日 'YYYY-MM-DD' */
  date: string
  /** 給油時のODOメーター値(km) */
  odo: number
  /** 給油量(L・小数2桁) */
  fuelAmount: number
  /** 支払金額(円)。任意 — 未入力は null */
  totalPrice: number | null
  /** 単価(円/L)。金額が入力された場合のみ保持。金額未入力なら null */
  unitPrice: number | null
  /** 満タンか(燃費計算の区切り判定)。初期値: true */
  isFullTank: boolean
  /** 給油所名 */
  stationName?: string
  memo?: string
  /**
   * 算出燃費(km/L)。保存時に満タン法で計算してキャッシュする。
   * 部分給油・区間未確定・初回給油は null。
   * 記録の追加・編集・削除時にリポジトリ層が影響区間を再計算する。
   */
  fuelEconomy: number | null
}

/** メンテナンス記録(§5.3) */
export interface MaintenanceRecord extends BaseEntity {
  vehicleId: string
  type: MaintenanceType
  /** type === 'other' のときの自由記述名 */
  typeLabel?: string
  /** 実施日 'YYYY-MM-DD' */
  date: string
  /** 実施時ODO(km) */
  odo: number
  /** 費用(円)。0円可・不明(null)許容 */
  cost: number | null
  /** 実施店舗 */
  shopName?: string
  /** 交換部品・銘柄など */
  memo?: string
}

/** リマインダールール(§5.4)【フェーズ2】— 型のみ先行定義 */
export interface ReminderRule extends BaseEntity {
  vehicleId: string
  maintenanceType: MaintenanceType
  /** 距離間隔(km)。intervalMonths と少なくとも一方は必須 */
  intervalKm?: number
  /** 期間間隔(月) */
  intervalMonths?: number
  isEnabled: boolean
}

/** アプリ設定(端末に保存し起動時に復元する) */
export interface AppSettings {
  /** 選択中の車両ID(未選択・未登録時は null) */
  selectedVehicleId: string | null
  /** 最後にJSONバックアップを書き出した日時(ISO 8601)。未実施は null(S-09 に表示) */
  lastBackupAt: string | null
}
