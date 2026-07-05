/**
 * 初度登録年月からの経過年月 — 純粋関数のみ。UI・DBに依存しない。
 * 用途: S-08 車両一覧の補足表示・車両フォームの欄下ヒント(ライブ表示)
 */

/** 'YYYY-MM' 形式(月は 01〜12)にマッチするパターン */
const YM_PATTERN = /^(\d{4})-(\d{2})$/

/**
 * 初度登録年月('YYYY-MM')から today までの経過を「◯年◯ヶ月」形式で返す。
 *
 * 表記ルール(自然な日本語表記):
 *   - 1年未満       → 「◯ヶ月」(当月は「0ヶ月」)
 *   - ちょうど◯年   → 「◯年」
 *   - それ以外       → 「◯年◯ヶ月」
 *
 * 日にちは考慮しない(年月単位の差分)。
 * 未来の年月・'YYYY-MM' でない文字列・存在しない月は null を返す(呼び出し側は非表示にする)。
 */
export function elapsedYearsMonths(firstRegistrationYm: string, today: Date): string | null {
  const match = YM_PATTERN.exec(firstRegistrationYm)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  if (month < 1 || month > 12) return null

  const totalMonths = (today.getFullYear() - year) * 12 + (today.getMonth() + 1 - month)
  if (totalMonths < 0) return null // 未来の年月

  const years = Math.floor(totalMonths / 12)
  const months = totalMonths % 12
  if (years === 0) return `${months}ヶ月`
  if (months === 0) return `${years}年`
  return `${years}年${months}ヶ月`
}
