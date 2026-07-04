/**
 * 入力バリデーション — 純粋関数のみ。UI・DBに依存しない。
 * 参照: docs/design/画面設計書.md §0.2 バリデーション表示の共通ルール / 要件定義書 §6.1
 *
 * レベルの意味:
 *   - error   : 必須未入力・不正値。保存ボタンを無効化する(保存不可)
 *   - warning : ODO逆行 / タンク容量超過 / 燃費1〜60km/L範囲外。
 *               欄下に警告チップを表示するが「保存はブロックしない」
 */
import { previewFuelEconomy, type FuelRecordForCalc } from './fuelEconomy'

export type ValidationLevel = 'error' | 'warning'

export type ValidationCode =
  // エラー(保存不可)
  | 'odo_required'
  | 'fuel_amount_required'
  | 'date_required'
  | 'maintenance_type_required'
  | 'name_required'
  | 'invalid_number'
  // 警告(保存可)
  | 'odo_reversal'
  | 'tank_capacity_exceeded'
  | 'economy_out_of_range'
  | 'future_date'

export interface ValidationIssue {
  level: ValidationLevel
  code: ValidationCode
  /** 対象フィールド名(警告チップを出す欄の特定に使う) */
  field: string
  /** 表示用メッセージ(日本語) */
  message: string
}

export interface ValidationResult {
  issues: ValidationIssue[]
  errors: ValidationIssue[]
  warnings: ValidationIssue[]
  /** エラーが無ければ true(警告があっても保存可) */
  canSave: boolean
}

/** 燃費の妥当範囲(km/L)。範囲外は入力ミスの可能性として警告(要件 §6.1) */
export const ECONOMY_RANGE = { min: 1, max: 60 } as const

/** 端末ローカルの今日 'YYYY-MM-DD'(テストでは context.today で差し替える) */
const localToday = (): string => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`
}

/** 日付が未来なら警告を返す(B-4: 保存はブロックしない) */
const futureDateIssue = (
  date: string | null | undefined,
  today: string | null | undefined,
): ValidationIssue | null => {
  if (!date || date <= (today || localToday())) return null
  return {
    level: 'warning',
    code: 'future_date',
    field: 'date',
    message: '未来の日付です。入力ミスの可能性があります',
  }
}

const buildResult = (issues: ValidationIssue[]): ValidationResult => {
  const errors = issues.filter((i) => i.level === 'error')
  const warnings = issues.filter((i) => i.level === 'warning')
  return { issues, errors, warnings, canSave: errors.length === 0 }
}

/** 入力途中の値: 未入力は null/undefined で表現する */
export interface FuelRecordFormInput {
  date?: string | null
  odo?: number | null
  fuelAmount?: number | null
  /** 任意項目。未入力は null/undefined(エラーにはならない) */
  totalPrice?: number | null
  isFullTank: boolean
}

/** バリデーションに使う周辺情報 */
export interface FuelValidationContext {
  /** 対象車両の直前(最新)記録のODO。無ければ null(ODO逆行警告に使用) */
  previousOdo?: number | null
  /** 対象車両のタンク容量(L)。未設定なら null(容量超過警告に使用) */
  tankCapacity?: number | null
  /** 対象車両の既存の全給油記録(燃費範囲警告のプレビュー計算に使用) */
  existingRecords?: readonly FuelRecordForCalc[]
  /** 「今日」の 'YYYY-MM-DD'(未来日付警告の基準)。省略時は端末ローカルの今日 */
  today?: string | null
}

const isEmpty = (v: number | null | undefined): v is null | undefined =>
  v === null || v === undefined || Number.isNaN(v)

/**
 * 給油記録入力のバリデーション(S-02 / S-04)。
 * 入力のたびに呼び出してライブ再評価する想定。
 *
 * 必須はODO・給油量の2項目のみ(金額は任意 — 要件 F-02)。
 */
export function validateFuelRecord(
  input: FuelRecordFormInput,
  context: FuelValidationContext = {},
): ValidationResult {
  const issues: ValidationIssue[] = []

  // --- エラー(必須・不正値。保存不可) ---
  if (!input.date) {
    issues.push({
      level: 'error',
      code: 'date_required',
      field: 'date',
      message: '給油日を入力してください',
    })
  }
  if (isEmpty(input.odo)) {
    issues.push({
      level: 'error',
      code: 'odo_required',
      field: 'odo',
      message: 'ODOメーター値を入力してください',
    })
  } else if (input.odo < 0) {
    issues.push({
      level: 'error',
      code: 'invalid_number',
      field: 'odo',
      message: 'ODOメーター値は0以上で入力してください',
    })
  }
  if (isEmpty(input.fuelAmount)) {
    issues.push({
      level: 'error',
      code: 'fuel_amount_required',
      field: 'fuelAmount',
      message: '給油量を入力してください',
    })
  } else if (input.fuelAmount <= 0) {
    issues.push({
      level: 'error',
      code: 'invalid_number',
      field: 'fuelAmount',
      message: '給油量は0より大きい値で入力してください',
    })
  }
  // 金額は任意: 未入力はエラーにしない。入力された場合のみ値をチェック
  if (!isEmpty(input.totalPrice) && input.totalPrice < 0) {
    issues.push({
      level: 'error',
      code: 'invalid_number',
      field: 'totalPrice',
      message: '金額は0以上で入力してください',
    })
  }

  // --- 警告(保存はブロックしない) ---
  const futureDate = futureDateIssue(input.date, context.today)
  if (futureDate) issues.push(futureDate)

  if (!isEmpty(input.odo) && input.odo >= 0) {
    const prev = context.previousOdo
    if (prev !== null && prev !== undefined && input.odo < prev) {
      issues.push({
        level: 'warning',
        code: 'odo_reversal',
        field: 'odo',
        message: `走行距離がマイナスです(前回 ${prev.toLocaleString()} km)。入力ミスの可能性があります`,
      })
    }
  }

  if (!isEmpty(input.fuelAmount) && input.fuelAmount > 0) {
    const capacity = context.tankCapacity
    if (capacity !== null && capacity !== undefined && input.fuelAmount > capacity) {
      issues.push({
        level: 'warning',
        code: 'tank_capacity_exceeded',
        field: 'fuelAmount',
        message: `給油量がタンク容量(${capacity} L)を超えています`,
      })
    }
  }

  if (!isEmpty(input.odo) && !isEmpty(input.fuelAmount) && input.fuelAmount > 0) {
    // date も渡す: 過去日付の後追い入力でも実際の時系列位置で燃費を計算する
    const preview = previewFuelEconomy(context.existingRecords ?? [], {
      odo: input.odo,
      fuelAmount: input.fuelAmount,
      isFullTank: input.isFullTank,
      date: input.date,
    })
    if (preview && (preview.economy < ECONOMY_RANGE.min || preview.economy > ECONOMY_RANGE.max)) {
      issues.push({
        level: 'warning',
        code: 'economy_out_of_range',
        field: 'fuelAmount',
        message: `算出燃費が ${preview.economy} km/L です(通常 ${ECONOMY_RANGE.min}〜${ECONOMY_RANGE.max} km/L)。入力ミスの可能性があります`,
      })
    }
  }

  return buildResult(issues)
}

/** 車両フォーム入力(S-08。入力途中の値。未入力は null/undefined) */
export interface VehicleFormInput {
  name?: string | null
  initialOdo?: number | null
  /** 任意項目。未入力は null/undefined(エラーにはならない) */
  tankCapacity?: number | null
}

/**
 * 車両登録・編集フォームのバリデーション(S-08)。
 * 必須は車両名・登録時ODOの2項目。タンク容量は任意だが、入力された場合は正の数のみ。
 */
export function validateVehicle(input: VehicleFormInput): ValidationResult {
  const issues: ValidationIssue[] = []

  if (!input.name || input.name.trim() === '') {
    issues.push({
      level: 'error',
      code: 'name_required',
      field: 'name',
      message: '車両名を入力してください',
    })
  }
  if (isEmpty(input.initialOdo)) {
    issues.push({
      level: 'error',
      code: 'odo_required',
      field: 'initialOdo',
      message: '登録時ODOを入力してください',
    })
  } else if (input.initialOdo < 0) {
    issues.push({
      level: 'error',
      code: 'invalid_number',
      field: 'initialOdo',
      message: '登録時ODOは0以上で入力してください',
    })
  }
  // タンク容量は任意: 未入力はエラーにしない。入力された場合のみ値をチェック
  if (!isEmpty(input.tankCapacity) && input.tankCapacity <= 0) {
    issues.push({
      level: 'error',
      code: 'invalid_number',
      field: 'tankCapacity',
      message: 'タンク容量は0より大きい値で入力してください',
    })
  }

  return buildResult(issues)
}

/** メンテナンス記録入力(入力途中の値) */
export interface MaintenanceFormInput {
  type?: string | null
  date?: string | null
  odo?: number | null
  cost?: number | null
}

export interface MaintenanceValidationContext {
  /** 対象車両の最新給油記録などから推定した現在ODO(逆行警告に使用) */
  previousOdo?: number | null
  /** 「今日」の 'YYYY-MM-DD'(未来日付警告の基準)。省略時は端末ローカルの今日 */
  today?: string | null
}

/**
 * メンテナンス記録入力のバリデーション(S-05)。
 * 種別・ODO・日付が必須。費用は任意(0円可)。ODO警告は給油入力と同様(保存可)。
 */
export function validateMaintenanceRecord(
  input: MaintenanceFormInput,
  context: MaintenanceValidationContext = {},
): ValidationResult {
  const issues: ValidationIssue[] = []

  if (!input.type) {
    issues.push({
      level: 'error',
      code: 'maintenance_type_required',
      field: 'type',
      message: '種別を選択してください',
    })
  }
  if (!input.date) {
    issues.push({
      level: 'error',
      code: 'date_required',
      field: 'date',
      message: '実施日を入力してください',
    })
  }
  if (isEmpty(input.odo)) {
    issues.push({
      level: 'error',
      code: 'odo_required',
      field: 'odo',
      message: 'ODOメーター値を入力してください',
    })
  } else if (input.odo < 0) {
    issues.push({
      level: 'error',
      code: 'invalid_number',
      field: 'odo',
      message: 'ODOメーター値は0以上で入力してください',
    })
  }
  if (!isEmpty(input.cost) && input.cost < 0) {
    issues.push({
      level: 'error',
      code: 'invalid_number',
      field: 'cost',
      message: '費用は0以上で入力してください',
    })
  }

  const futureDate = futureDateIssue(input.date, context.today)
  if (futureDate) issues.push(futureDate)

  if (!isEmpty(input.odo) && input.odo >= 0) {
    const prev = context.previousOdo
    if (prev !== null && prev !== undefined && input.odo < prev) {
      issues.push({
        level: 'warning',
        code: 'odo_reversal',
        field: 'odo',
        message: `現在の走行距離(${prev.toLocaleString()} km)より小さい値です。入力ミスの可能性があります`,
      })
    }
  }

  return buildResult(issues)
}
