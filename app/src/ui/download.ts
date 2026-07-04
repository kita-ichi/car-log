/**
 * テキストファイルのダウンロード(F-11 エクスポート用)
 *
 * Blob + a[download] 方式。iOS Safari(13+)・Android Chrome の両方で動く
 * 標準的な手法(iOS はダウンロードではなく共有シート/ファイル保存になる場合がある)。
 */
import type { ExportPayload } from '../db/exportService'

export function downloadTextFile({ filename, content, mimeType }: ExportPayload): void {
  // charset を明示(BOM付きCSV・JSONともUTF-8)
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // iOS Safari がダウンロードを開始する前に revoke しないよう遅延させる
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
