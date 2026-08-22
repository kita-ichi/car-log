/**
 * 愛車の写真(F-22)— 画像処理の純粋関数
 * 参照: docs/要件定義書.md §5.1 Vehicle / F-22 愛車の写真設定
 *
 * この層は canvas・File API・DOM に依存しない(計算とバリデーションのみ)。
 * 実際のデコード・リサイズ・JPEG圧縮は `ui/imageProcessing.ts`(薄いラッパー)が担う。
 *
 * 方針:
 * - スマホの写真は 3〜12MB あるため、保存前に長辺 MAX_PHOTO_EDGE px 以下へ縮小し
 *   JPEG(品質 PHOTO_JPEG_QUALITY)で再エンコードする(見積もり 150〜350KB)
 * - 元画像が上限より小さい場合は拡大しない(引き伸ばしてもファイルが太るだけ)
 */

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

/** 保存する写真の長辺上限(px)。Retina 相当の一覧・詳細表示に十分なサイズ */
export const MAX_PHOTO_EDGE = 1280

/** JPEG 再エンコードの品質(0〜1)。0.85 は画質とサイズのバランス点 */
export const PHOTO_JPEG_QUALITY = 0.85

/** 保存後の画像フォーマット(全端末でデコードできる JPEG に統一する) */
export const PHOTO_MIME_TYPE = 'image/jpeg'

/** 取り込みを受け付ける元ファイルの上限(20MB)。これを超えるものは端末が落ちる恐れがあるため弾く */
export const MAX_SOURCE_FILE_BYTES = 20 * 1024 * 1024

/**
 * 受け付けない画像 MIME タイプ。
 * SVG は実体がスクリプトを含みうるマークアップで、canvas に描くと
 * 外部参照・スクリプト実行の温床になるため写真としては扱わない。
 */
const REJECTED_IMAGE_TYPES = ['image/svg+xml'] as const

// ---------------------------------------------------------------------------
// エラー
// ---------------------------------------------------------------------------

/** 画像取り込みの失敗理由 */
export type ImageErrorCode =
  /** 画像ファイルではない(image/* でない) */
  | 'not_an_image'
  /** 画像だが写真として扱わない形式(SVG など) */
  | 'unsupported_type'
  /** 上限バイト数を超えている */
  | 'too_large'
  /** 中身が空 */
  | 'empty'
  /** デコード・エンコードに失敗した(壊れたファイル・未対応コーデック) */
  | 'decode_failed'

/**
 * 画像取り込みのエラー。
 * `message` は日本語の表示文そのままなので UI はトースト等に流用してよい
 * (validation.ts の issue.message と同じ方針)。
 */
export class ImageError extends Error {
  readonly code: ImageErrorCode

  constructor(code: ImageErrorCode, message: string) {
    super(message)
    this.name = 'ImageError'
    this.code = code
  }
}

// ---------------------------------------------------------------------------
// 寸法計算
// ---------------------------------------------------------------------------

/** 画像の寸法(px) */
export interface Dimensions {
  width: number
  height: number
}

/**
 * 元の寸法を、アスペクト比を保ったまま長辺 `maxEdge` px 以内へ収めた寸法を返す。
 *
 * - 元画像が既に収まっている場合はそのまま返す(**拡大はしない**)
 * - 結果は 1px 以上の整数(canvas は整数ピクセルしか扱えないため四捨五入する)
 * - 縮小時の長辺はちょうど `maxEdge` になる
 *
 * @throws {ImageError} 幅・高さ・maxEdge が正の有限数でない場合
 */
export function fitWithin(width: number, height: number, maxEdge: number = MAX_PHOTO_EDGE): Dimensions {
  assertPositive('幅', width)
  assertPositive('高さ', height)
  assertPositive('長辺の上限', maxEdge)

  const longest = Math.max(width, height)
  if (longest <= maxEdge) {
    // 拡大しない。ただし整数化はする(小数の寸法を渡された場合の保険)
    return { width: roundEdge(width), height: roundEdge(height) }
  }
  const scale = maxEdge / longest
  return { width: roundEdge(width * scale), height: roundEdge(height * scale) }
}

/** 縮小が必要かどうか(不要ならデコード後の再エンコードだけで済む) */
export function needsDownscale(width: number, height: number, maxEdge: number = MAX_PHOTO_EDGE): boolean {
  return Math.max(width, height) > maxEdge
}

/** 1px 未満に潰れないよう丸める(極端に細長い画像対策) */
function roundEdge(value: number): number {
  return Math.max(1, Math.round(value))
}

function assertPositive(label: string, value: number): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new ImageError('decode_failed', `画像の${label}が不正です: ${String(value)}`)
  }
}

// ---------------------------------------------------------------------------
// 入力バリデーション
// ---------------------------------------------------------------------------

/** バリデーション対象(File / Blob がそのまま渡せる形) */
export interface ImageSourceInfo {
  /** MIME タイプ(File.type / Blob.type) */
  type: string
  /** バイト数(File.size / Blob.size) */
  size: number
}

/**
 * 取り込もうとしているファイルが写真として扱えるかを検査する。
 * 問題があれば `ImageError` を throw する(UI はメッセージをそのまま表示できる)。
 */
export function assertProcessableImage(
  source: ImageSourceInfo,
  maxBytes: number = MAX_SOURCE_FILE_BYTES,
): void {
  const type = (source.type ?? '').toLowerCase()

  if (!type.startsWith('image/')) {
    throw new ImageError('not_an_image', '画像ファイルを選んでください(写真以外は設定できません)')
  }
  if ((REJECTED_IMAGE_TYPES as readonly string[]).includes(type)) {
    throw new ImageError('unsupported_type', 'この形式の画像は設定できません(JPEG・PNG などの写真を選んでください)')
  }
  if (!Number.isFinite(source.size) || source.size <= 0) {
    throw new ImageError('empty', '画像ファイルが空です')
  }
  if (source.size > maxBytes) {
    throw new ImageError(
      'too_large',
      `画像が大きすぎます(${formatByteSize(source.size)})。${formatByteSize(maxBytes)} 以下の画像を選んでください`,
    )
  }
}

// ---------------------------------------------------------------------------
// 表示用フォーマット
// ---------------------------------------------------------------------------

/**
 * バイト数を「1.2 MB」「320 KB」のように整形する(写真の容量表示・エラーメッセージ用)。
 * 1024 進数。KB 未満は「◯ B」。
 */
export function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`
  const mb = kb / 1024
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`
}

/**
 * 圧縮前後のサイズ表示(S-08 写真ピッカー): 「3.4 MB → 210 KB」。
 *
 * 元ファイルが既に小さく縮まなかった場合(元 ≦ 保存後)は矢印を出さず保存後だけを返す
 * (「210 KB → 240 KB」のような読み手が不安になる表示を作らない)。
 */
export function formatCompressionNote(sourceBytes: number, resultBytes: number): string {
  const result = formatByteSize(resultBytes)
  if (result === '—') return '—'
  if (!Number.isFinite(sourceBytes) || sourceBytes <= resultBytes) return result
  return `${formatByteSize(sourceBytes)} → ${result}`
}

/**
 * 写真の保存容量サマリ(S-09 バックアップ): 「写真 3枚 ・ 約 620 KB」。
 * 1枚も無いときは null(呼び出し側で「登録された写真はありません」等に差し替える)。
 */
export function formatPhotoSummary(count: number, totalBytes: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null
  return `写真 ${Math.round(count)}枚 ・ 約 ${formatByteSize(totalBytes)}`
}
