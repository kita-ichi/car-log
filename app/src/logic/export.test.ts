/**
 * F-11 データエクスポートのテスト
 * - JSON: 往復(serialize → parse)で全フィールドが保持されること
 * - CSV: エスケープ(カンマ・改行・クォート・数式インジェクション)、
 *        金額なしの空欄、記録0件、複数車両、BOM・CRLF
 */
import { describe, expect, it } from 'vitest'
import type { AppSettings, FuelRecord, MaintenanceRecord, Vehicle } from '../types/models'
import {
  BACKUP_FORMAT,
  BACKUP_SCHEMA_VERSION,
  CSV_BOM,
  backupFileName,
  backupToPhotoBytes,
  buildBackup,
  buildFuelCsv,
  buildMaintenanceCsv,
  csvField,
  fuelCsvFileName,
  localDateString,
  maintenanceCsvFileName,
  photoToBackup,
  serializeBackup,
  type BackupData,
  type BackupFile,
  type VehiclePhotoBackup,
} from './export'
import { DEFAULT_PHOTO_ADJUST, normalizePhotoAdjust } from './photoAdjust'

// ---------------------------------------------------------------------------
// テストデータ(全フィールドを埋めた記録+任意項目なしの記録)
// ---------------------------------------------------------------------------

const vehicleFull: Vehicle = {
  id: 'v1',
  createdAt: '2026-07-01T09:00:00.000Z',
  updatedAt: '2026-07-02T09:00:00.000Z',
  vehicleType: 'car',
  name: 'ノート',
  maker: '日産',
  model: 'E13',
  firstRegistrationYm: '2021-03',
  initialOdo: 10000,
  fuelType: 'regular',
  tankCapacity: 41,
  inspectionExpiry: '2027-03-31',
  isArchived: false,
}

/** アーカイブ済み・任意項目なしの車両(バックアップに含まれること) */
const vehicleArchived: Vehicle = {
  id: 'v2',
  createdAt: '2026-07-03T09:00:00.000Z',
  updatedAt: '2026-07-03T09:00:00.000Z',
  vehicleType: 'motorcycle',
  name: 'MT-07',
  initialOdo: 18000,
  fuelType: 'premium',
  isArchived: true,
}

const fuelFull: FuelRecord = {
  id: 'f1',
  createdAt: '2026-07-01T10:00:00.000Z',
  updatedAt: '2026-07-01T10:00:00.000Z',
  vehicleId: 'v1',
  date: '2026-07-01',
  odo: 10400,
  fuelAmount: 32.5,
  totalPrice: 5200,
  unitPrice: 160,
  isFullTank: true,
  stationName: 'ENEOS 中央店',
  memo: '帰省前',
  fuelEconomy: 12.3,
}

/** 金額なし・部分給油・燃費未確定・任意項目なし */
const fuelMinimal: FuelRecord = {
  id: 'f2',
  createdAt: '2026-07-10T10:00:00.000Z',
  updatedAt: '2026-07-10T10:00:00.000Z',
  vehicleId: 'v2',
  date: '2026-07-10',
  odo: 18200,
  fuelAmount: 8.01,
  totalPrice: null,
  unitPrice: null,
  isFullTank: false,
  fuelEconomy: null,
}

const maintFull: MaintenanceRecord = {
  id: 'm1',
  createdAt: '2026-07-02T10:00:00.000Z',
  updatedAt: '2026-07-02T10:00:00.000Z',
  vehicleId: 'v1',
  type: 'oil_change',
  date: '2026-07-02',
  odo: 10500,
  cost: 4800,
  shopName: 'オートバックス',
  memo: '0W-20',
}

/** 費用不明(null)・「その他」種別(typeLabel あり) */
const maintMinimal: MaintenanceRecord = {
  id: 'm2',
  createdAt: '2026-07-11T10:00:00.000Z',
  updatedAt: '2026-07-11T10:00:00.000Z',
  vehicleId: 'v2',
  type: 'other',
  typeLabel: 'チェーン清掃',
  date: '2026-07-11',
  odo: 18300,
  cost: null,
}

const settings: AppSettings = { selectedVehicleId: 'v1', lastBackupAt: null }

const fullData: BackupData = {
  vehicles: [vehicleFull, vehicleArchived],
  fuelRecords: [fuelFull, fuelMinimal],
  maintenanceRecords: [maintFull, maintMinimal],
  settings,
}

/** CSV文字列 → 行配列(BOMを剥がしてCRLFで分割) */
function csvLines(csv: string): string[] {
  expect(csv.startsWith(CSV_BOM)).toBe(true)
  return csv.slice(CSV_BOM.length).split('\r\n')
}

// ---------------------------------------------------------------------------
// JSON バックアップ
// ---------------------------------------------------------------------------

describe('JSONバックアップ', () => {
  it('メタ情報(format / schemaVersion / exportedAt)が付く', () => {
    const backup = buildBackup(fullData, '2026-07-04T12:00:00.000Z')
    expect(backup.format).toBe(BACKUP_FORMAT)
    expect(backup.schemaVersion).toBe(BACKUP_SCHEMA_VERSION)
    expect(backup.exportedAt).toBe('2026-07-04T12:00:00.000Z')
  })

  it('往復(serialize → JSON.parse)で全データ・全フィールドが完全に復元できる', () => {
    const backup = buildBackup(fullData, '2026-07-04T12:00:00.000Z')
    const parsed = JSON.parse(serializeBackup(backup)) as BackupFile
    // アーカイブ済み車両・任意項目・null をすべて含めて完全一致(F-15 インポートの前提)
    expect(parsed).toEqual(backup)
    expect(parsed.data.vehicles).toHaveLength(2)
    expect(parsed.data.vehicles[1].isArchived).toBe(true)
    expect(parsed.data.fuelRecords[1].totalPrice).toBeNull()
    expect(parsed.data.settings.selectedVehicleId).toBe('v1')
  })

  it('記録0件でもエクスポートできる', () => {
    const empty: BackupData = {
      vehicles: [],
      fuelRecords: [],
      maintenanceRecords: [],
      settings: { selectedVehicleId: null, lastBackupAt: null },
    }
    const parsed = JSON.parse(serializeBackup(buildBackup(empty, '2026-07-04T12:00:00.000Z')))
    expect(parsed.data.vehicles).toEqual([])
    expect(parsed.data.fuelRecords).toEqual([])
  })

  /* ---- 写真の表示調整(F-22b) ---- */

  it('写真の表示調整(photoAdjust)が往復で保たれる', () => {
    const adjust = { zoom: 1.5, focusX: 0.2, focusY: 0.8 }
    const data: BackupData = {
      ...fullData,
      vehicles: [{ ...fullData.vehicles[0], photoUpdatedAt: '2026-08-28T00:00:00.000Z', photoAdjust: adjust }],
    }
    const parsed = JSON.parse(serializeBackup(buildBackup(data, '2026-08-28T12:00:00.000Z'))) as BackupFile
    expect(parsed.data.vehicles[0].photoAdjust).toEqual(adjust)
  })

  it('調整していない車両には photoAdjust キーが入らない(ファイルが太らない)', () => {
    const json = serializeBackup(buildBackup(fullData, '2026-08-28T12:00:00.000Z'))
    expect(json).not.toContain('photoAdjust')
  })

  it('写真を含めずに書き出しても調整値は残る(写真を入れ直せば構図が戻る)', () => {
    const adjust = { zoom: 2, focusX: 0.1, focusY: 0.1 }
    const data: BackupData = {
      ...fullData,
      vehicles: [{ ...fullData.vehicles[0], photoUpdatedAt: '2026-08-28T00:00:00.000Z', photoAdjust: adjust }],
      // vehiclePhotos を付けない = 「写真を含めない」でのエクスポート
    }
    const parsed = JSON.parse(serializeBackup(buildBackup(data, '2026-08-28T12:00:00.000Z'))) as BackupFile
    expect(parsed.includesPhotos).toBe(false)
    expect(parsed.data.vehicles[0].photoAdjust).toEqual(adjust)
  })

  it('スキーマバージョンは 3(表示調整の追加で +1)', () => {
    expect(BACKUP_SCHEMA_VERSION).toBe(3)
  })

  it('旧バージョン(v1 / v2)のファイルもそのまま読める(photoAdjust は追加のみ)', () => {
    // v2 相当のファイル = 車両に photoAdjust キーが無い
    const oldFile = {
      format: BACKUP_FORMAT,
      schemaVersion: 2,
      exportedAt: '2026-07-05T12:00:00.000Z',
      includesPhotos: true,
      data: {
        ...fullData,
        vehicles: [{ ...fullData.vehicles[0], photoUpdatedAt: '2026-07-05T00:00:00.000Z' }],
        vehiclePhotos: [],
      },
    }
    const parsed = JSON.parse(JSON.stringify(oldFile)) as BackupFile
    // 車両として読めて、調整値は「未設定」= 既定値(cover + center)として扱われる
    expect(parsed.data.vehicles[0].photoAdjust).toBeUndefined()
    expect(normalizePhotoAdjust(parsed.data.vehicles[0].photoAdjust)).toEqual(DEFAULT_PHOTO_ADJUST)
  })
})

// ---------------------------------------------------------------------------
// 愛車の写真(F-22)のバックアップ
// ---------------------------------------------------------------------------

describe('バックアップへの写真の格納', () => {
  /** JPEG のシグネチャを含む擬似画像バイト列(0〜255 を一巡させる) */
  const photoBytes = (marker: number, size = 300): Uint8Array => {
    const bytes = new Uint8Array(size)
    bytes.set([0xff, 0xd8, 0xff, marker])
    for (let i = 4; i < size; i++) bytes[i] = (i * 7 + marker) & 0xff
    return bytes
  }

  const photoMeta = {
    vehicleId: 'v1',
    mimeType: 'image/jpeg',
    byteSize: 300,
    width: 1280,
    height: 960,
    updatedAt: '2026-07-05T01:00:00.000Z',
  }

  it('写真がJSONを経由してもバイト単位で完全に復元できる', () => {
    const bytes = photoBytes(0x11)
    const entry = photoToBackup(photoMeta, bytes)
    // JSONに載せて読み戻す(実際のバックアップと同じ経路)
    const restored = JSON.parse(JSON.stringify(entry)) as VehiclePhotoBackup
    expect(backupToPhotoBytes(restored)).toEqual(bytes)
  })

  it('メタ情報(MIMEタイプ・寸法・更新日時)も保持される', () => {
    const entry = photoToBackup(photoMeta, photoBytes(0x11))
    expect(entry.vehicleId).toBe('v1')
    expect(entry.mimeType).toBe('image/jpeg')
    expect(entry.width).toBe(1280)
    expect(entry.height).toBe(960)
    expect(entry.updatedAt).toBe('2026-07-05T01:00:00.000Z')
    expect(entry.byteSize).toBe(300)
    expect(entry.dataBase64).toMatch(/^[A-Za-z0-9+/]+={0,2}$/)
  })

  it('寸法が不明な写真はキーごと省略される', () => {
    const entry = photoToBackup(
      { vehicleId: 'v1', mimeType: 'image/jpeg', byteSize: 8, updatedAt: '2026-07-05T01:00:00.000Z' },
      photoBytes(0x11, 8),
    )
    expect('width' in entry).toBe(false)
    expect('height' in entry).toBe(false)
  })

  it('バイト数が記録と食い違うファイルは壊れているとして弾く', () => {
    const entry = photoToBackup(photoMeta, photoBytes(0x11))
    expect(() => backupToPhotoBytes({ ...entry, byteSize: 999 })).toThrow(/壊れています/)
  })

  it('data.vehiclePhotos の有無が includesPhotos に反映される', () => {
    const withPhotos = buildBackup(
      { ...fullData, vehiclePhotos: [photoToBackup(photoMeta, photoBytes(0x11))] },
      '2026-07-04T12:00:00.000Z',
    )
    expect(withPhotos.includesPhotos).toBe(true)
    expect(buildBackup(fullData, '2026-07-04T12:00:00.000Z').includesPhotos).toBe(false)
    // 「含めたが0枚」も写真ありの扱い(インポート時に既存写真を消してよい根拠になる)
    expect(buildBackup({ ...fullData, vehiclePhotos: [] }, '2026-07-04T12:00:00.000Z').includesPhotos).toBe(
      true,
    )
  })

  it('写真入りバックアップも往復で完全一致する', () => {
    const backup = buildBackup(
      {
        ...fullData,
        vehiclePhotos: [
          photoToBackup(photoMeta, photoBytes(0x11)),
          photoToBackup({ ...photoMeta, vehicleId: 'v2' }, photoBytes(0x22)),
        ],
      },
      '2026-07-04T12:00:00.000Z',
    )
    const parsed = JSON.parse(serializeBackup(backup)) as BackupFile
    expect(parsed).toEqual(backup)
    expect(parsed.data.vehiclePhotos).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// CSV エスケープ
// ---------------------------------------------------------------------------

describe('csvField(エスケープ)', () => {
  it('カンマを含む値はダブルクォートで囲む', () => {
    expect(csvField('ENEOS, セルフ')).toBe('"ENEOS, セルフ"')
  })

  it('改行を含む値はダブルクォートで囲む', () => {
    expect(csvField('1行目\n2行目')).toBe('"1行目\n2行目"')
  })

  it('ダブルクォートは2つ重ねにして囲む', () => {
    expect(csvField('銘柄 "0W-20" 使用')).toBe('"銘柄 ""0W-20"" 使用"')
  })

  it('数式インジェクション(先頭の = + - @)はシングルクォートで無害化する', () => {
    expect(csvField('=SUM(A1)')).toBe("'=SUM(A1)")
    expect(csvField('+81-90')).toBe("'+81-90")
    expect(csvField('-メモ')).toBe("'-メモ")
    expect(csvField('@user')).toBe("'@user")
  })

  it('数式インジェクションとカンマの複合もエスケープできる', () => {
    expect(csvField('=1+1,=2+2')).toBe('"\'=1+1,=2+2"')
  })

  it('数値はそのまま・null と undefined は空欄', () => {
    expect(csvField(12.3)).toBe('12.3')
    expect(csvField(0)).toBe('0')
    expect(csvField(null)).toBe('')
    expect(csvField(undefined)).toBe('')
  })
})

// ---------------------------------------------------------------------------
// 給油記録 CSV
// ---------------------------------------------------------------------------

describe('buildFuelCsv', () => {
  it('BOM付き・日本語ヘッダ・CRLF区切りで生成される', () => {
    const lines = csvLines(buildFuelCsv([vehicleFull], [fuelFull]))
    expect(lines[0]).toBe('日付,車両名,ODO(km),給油量(L),単価(円/L),金額(円),満タン,燃費(km/L),給油所,メモ')
    expect(lines).toHaveLength(2)
  })

  it('全項目ありの記録が正しい列順で出る(車両名を含む)', () => {
    const lines = csvLines(buildFuelCsv([vehicleFull], [fuelFull]))
    expect(lines[1]).toBe('2026-07-01,ノート,10400,32.5,160,5200,満タン,12.3,ENEOS 中央店,帰省前')
  })

  it('金額なしは空欄・部分給油・燃費未確定(null)も空欄になる', () => {
    const lines = csvLines(buildFuelCsv([vehicleArchived], [fuelMinimal]))
    expect(lines[1]).toBe('2026-07-10,MT-07,18200,8.01,,,部分給油,,,')
  })

  it('記録0件ならヘッダのみ', () => {
    const lines = csvLines(buildFuelCsv([vehicleFull], []))
    expect(lines).toHaveLength(1)
  })

  it('複数車両: 車両ごと(登録順)→ 時系列昇順に並び、車両名が正しく付く', () => {
    // v1 の記録を日付逆順で渡しても、出力は v1(昇順)→ v2 の順になる
    const f1b: FuelRecord = { ...fuelFull, id: 'f3', date: '2026-06-01', odo: 10000 }
    const csv = buildFuelCsv([vehicleFull, vehicleArchived], [fuelMinimal, fuelFull, f1b])
    const lines = csvLines(csv)
    expect(lines[1].startsWith('2026-06-01,ノート')).toBe(true)
    expect(lines[2].startsWith('2026-07-01,ノート')).toBe(true)
    expect(lines[3].startsWith('2026-07-10,MT-07')).toBe(true)
  })

  it('カンマ・クォートを含む給油所名/メモが正しくエスケープされる', () => {
    const tricky: FuelRecord = {
      ...fuelFull,
      stationName: 'ENEOS, "セルフ"店',
      memo: '窓拭き\nタイヤ空気圧も',
    }
    const lines = csvLines(buildFuelCsv([vehicleFull], [tricky]))
    expect(lines[1]).toContain('"ENEOS, ""セルフ""店"')
    // 改行を含むメモは1レコードがクォート内で複数行にまたがる
    expect(csvLines(buildFuelCsv([vehicleFull], [tricky])).join('\r\n')).toContain(
      '"窓拭き\nタイヤ空気圧も"',
    )
  })
})

// ---------------------------------------------------------------------------
// メンテナンス記録 CSV
// ---------------------------------------------------------------------------

describe('buildMaintenanceCsv', () => {
  it('BOM付き・日本語ヘッダで生成される', () => {
    const lines = csvLines(buildMaintenanceCsv([vehicleFull], [maintFull]))
    expect(lines[0]).toBe('日付,車両名,種別,ODO(km),費用(円),店舗,メモ')
  })

  it('種別は日本語ラベルになる', () => {
    const lines = csvLines(buildMaintenanceCsv([vehicleFull], [maintFull]))
    expect(lines[1]).toBe('2026-07-02,ノート,オイル交換,10500,4800,オートバックス,0W-20')
  })

  it('「その他」は自由記述名(typeLabel)を優先し、費用不明は空欄になる', () => {
    const lines = csvLines(buildMaintenanceCsv([vehicleArchived], [maintMinimal]))
    expect(lines[1]).toBe('2026-07-11,MT-07,チェーン清掃,18300,,,')
  })

  it('費用0円は空欄ではなく 0 と出る(0円可の仕様)', () => {
    const zeroCost: MaintenanceRecord = { ...maintFull, cost: 0 }
    const lines = csvLines(buildMaintenanceCsv([vehicleFull], [zeroCost]))
    expect(lines[1]).toContain(',0,')
  })

  it('記録0件ならヘッダのみ', () => {
    expect(csvLines(buildMaintenanceCsv([], []))).toHaveLength(1)
  })

  it('複数車両で車両名が正しく対応する', () => {
    const lines = csvLines(
      buildMaintenanceCsv([vehicleFull, vehicleArchived], [maintMinimal, maintFull]),
    )
    expect(lines[1]).toContain('ノート')
    expect(lines[2]).toContain('MT-07')
  })
})

// ---------------------------------------------------------------------------
// ファイル名
// ---------------------------------------------------------------------------

describe('ファイル名', () => {
  it('日付入りのファイル名を組み立てる', () => {
    expect(backupFileName('2026-07-04')).toBe('car-log-backup-2026-07-04.json')
    expect(fuelCsvFileName('2026-07-04')).toBe('car-log-fuel-records-2026-07-04.csv')
    expect(maintenanceCsvFileName('2026-07-04')).toBe('car-log-maintenance-records-2026-07-04.csv')
  })

  it('localDateString はローカルタイムの YYYY-MM-DD(ゼロ埋め)', () => {
    expect(localDateString(new Date(2026, 6, 4))).toBe('2026-07-04')
    expect(localDateString(new Date(2026, 0, 9))).toBe('2026-01-09')
  })
})
