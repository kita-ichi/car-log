/** リポジトリ共通ヘルパー */

export const newId = (): string => crypto.randomUUID()

export const nowIso = (): string => new Date().toISOString()

/**
 * undefined / null のプロパティを取り除く(create 用)。
 * 新規作成時はどちらも「未設定」として扱い、キー自体を保存しない。
 */
export function stripAbsent<T extends object>(obj: T): { [K in keyof T]?: NonNullable<T[K]> } {
  const result = { ...obj }
  for (const key of Object.keys(result) as (keyof T)[]) {
    if (result[key] === undefined || result[key] === null) delete result[key]
  }
  return result as { [K in keyof T]?: NonNullable<T[K]> }
}

/** assertNumber の検証ルール */
export interface NumberRule {
  /** これ未満は拒否(例: 0 → 0以上のみ許容) */
  min?: number
  /** この値以下は拒否(例: 0 → 正の数のみ許容) */
  greaterThan?: number
  /** null を正規の値として許容するか(金額クリア等)。既定 false */
  nullable?: boolean
}

/**
 * リポジトリ入口の数値不変条件チェック。違反時は Error を throw する。
 * undefined は「未指定(update の変更なし・任意項目の省略)」としてチェックしない。
 * NaN・Infinity・非数値は常に拒否する。
 */
export function assertNumber(
  field: string,
  value: number | null | undefined,
  rule: NumberRule = {},
): void {
  if (value === undefined) return
  if (value === null) {
    if (rule.nullable) return
    throw new Error(`${field} に null は指定できません`)
  }
  if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) {
    throw new Error(`${field} が数値ではありません: ${String(value)}`)
  }
  if (rule.min !== undefined && value < rule.min) {
    throw new Error(`${field} は ${rule.min} 以上で指定してください: ${value}`)
  }
  if (rule.greaterThan !== undefined && value <= rule.greaterThan) {
    throw new Error(`${field} は ${rule.greaterThan} より大きい値で指定してください: ${value}`)
  }
}

/**
 * update 用パッチを Dexie の update() に渡す形へ整形する。
 *
 * Update 系の契約(UIとの取り決め):
 *   - undefined(またはキー省略)= 「変更なし」→ パッチから除去する
 *   - null = 「クリア」
 *     - clearableKeys のプロパティ(モデル上 `?` の任意項目)
 *       → 値 undefined に変換する。Dexie の Table.update は
 *         値が undefined のプロパティをレコードから削除する(= キー削除)
 *     - それ以外のプロパティ(totalPrice 等、モデル上 null が正規の値)
 *       → null をそのまま保存する
 */
export function toUpdatePatch<T extends object>(
  patch: T,
  clearableKeys: readonly (keyof T)[] = [],
): Partial<T> {
  const result: Partial<T> = {}
  for (const key of Object.keys(patch) as (keyof T)[]) {
    const value = patch[key]
    if (value === undefined) continue // 変更なし
    if (value === null && clearableKeys.includes(key)) {
      result[key] = undefined // Dexie がキーごと削除する
    } else {
      result[key] = value
    }
  }
  return result
}
