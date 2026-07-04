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
