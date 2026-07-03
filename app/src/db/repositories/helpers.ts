/** リポジトリ共通ヘルパー */

export const newId = (): string => crypto.randomUUID()

export const nowIso = (): string => new Date().toISOString()

/** undefined のプロパティを取り除く(Dexie の update 用パッチ整形) */
export function stripUndefined<T extends object>(obj: T): T {
  const result = { ...obj }
  for (const key of Object.keys(result) as (keyof T)[]) {
    if (result[key] === undefined) delete result[key]
  }
  return result
}
