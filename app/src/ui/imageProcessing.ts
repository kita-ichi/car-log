/**
 * 愛車の写真(F-22)— 画像のデコード・リサイズ・JPEG圧縮(ブラウザAPIの薄いラッパー)
 *
 * スマホの写真は 3〜12MB あるため、保存前にここで縮小・再エンコードしてから
 * vehicleRepository に渡す。**計算・判定のロジックは持たない**
 * (寸法計算とバリデーションは logic/image.ts の純粋関数。テストもそちら側)。
 *
 * 使い方(S-08 車両編集などの写真選択):
 *   const processed = await processVehiclePhoto(file)   // File(input[type=file])
 *   await vehicleRepository.setPhoto(vehicleId, processed)
 *
 * 補足:
 * - canvas 経由で再エンコードするため EXIF は結果に残らない。
 *   撮影位置(GPS)などが写真に紛れ込まないという利点もある
 * - 透過PNGを JPEG にすると透明部分が黒くなるため、白で下地を塗ってから描画する
 */
import {
  ImageError,
  MAX_PHOTO_EDGE,
  MAX_SOURCE_FILE_BYTES,
  PHOTO_JPEG_QUALITY,
  PHOTO_MIME_TYPE,
  assertProcessableImage,
  fitWithin,
} from '../logic/image'

/** 処理後の画像(vehicleRepository.setPhoto にそのまま渡せる) */
export interface ProcessedImage {
  /** 保存する画像(JPEG) */
  blob: Blob
  mimeType: string
  width: number
  height: number
  /** 保存する画像のバイト数 */
  byteSize: number
  /** 元ファイルのバイト数(「◯MB → ◯KB に圧縮しました」の表示用) */
  sourceByteSize: number
  sourceWidth: number
  sourceHeight: number
}

export interface ProcessOptions {
  /** 長辺の上限(px)。既定 1280 */
  maxEdge?: number
  /** JPEG品質(0〜1)。既定 0.85 */
  quality?: number
  /** 取り込みを許可する元ファイルの上限(byte)。既定 20MB */
  maxBytes?: number
}

/**
 * 選択された画像ファイルを、保存用のリサイズ済み JPEG に変換する。
 *
 * @throws {ImageError} 画像でない / 形式が不可 / 空 / 大きすぎる / デコード・エンコード失敗
 */
export async function processVehiclePhoto(
  file: Blob,
  options: ProcessOptions = {},
): Promise<ProcessedImage> {
  const { maxEdge = MAX_PHOTO_EDGE, quality = PHOTO_JPEG_QUALITY, maxBytes = MAX_SOURCE_FILE_BYTES } = options

  // 1. 入力の検査(純粋関数)。File / Blob はそのまま { type, size } として渡せる
  assertProcessableImage(file, maxBytes)

  // 2. デコード(EXIF の向きを反映した状態にする)
  const decoded = await decodeImage(file)
  try {
    // 3. 目標寸法の算出(純粋関数)
    const target = fitWithin(decoded.width, decoded.height, maxEdge)

    // 4. canvas に描画して JPEG へ再エンコード
    const blob = await drawToJpeg(decoded.source, target.width, target.height, quality)

    return {
      blob,
      mimeType: PHOTO_MIME_TYPE,
      width: target.width,
      height: target.height,
      byteSize: blob.size,
      sourceByteSize: file.size,
      sourceWidth: decoded.width,
      sourceHeight: decoded.height,
    }
  } finally {
    decoded.release()
  }
}

// ---------------------------------------------------------------------------
// デコード
// ---------------------------------------------------------------------------

interface DecodedImage {
  source: CanvasImageSource
  /** EXIF の向きを反映した後の寸法 */
  width: number
  height: number
  release: () => void
}

/**
 * 画像をデコードする。EXIF の向き情報(縦持ちで撮った写真が横向きになるやつ)は
 * どちらの経路でも反映される:
 * - `<img>`: CSS `image-orientation: from-image` が初期値(Safari 13.1+ / Chrome 81+)
 *   なので naturalWidth/Height と drawImage の結果が回転済みになる
 * - `createImageBitmap`: `imageOrientation: 'from-image'` を明示する
 *
 * iPhone(Safari)を主対象にするため、対応が確実な `<img>` を先に試し、
 * 失敗した場合のみ createImageBitmap にフォールバックする。
 */
async function decodeImage(blob: Blob): Promise<DecodedImage> {
  try {
    return await decodeWithImgElement(blob)
  } catch (error) {
    if (typeof createImageBitmap !== 'function') throw error
    try {
      const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' })
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      }
    } catch {
      throw error instanceof ImageError
        ? error
        : new ImageError('decode_failed', '画像を読み込めませんでした(対応していない形式の可能性があります)')
    }
  }
}

function decodeWithImgElement(blob: Blob): Promise<DecodedImage> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    const release = () => URL.revokeObjectURL(url)
    img.onload = () => {
      if (!img.naturalWidth || !img.naturalHeight) {
        release()
        reject(new ImageError('decode_failed', '画像を読み込めませんでした(サイズを取得できません)'))
        return
      }
      resolve({ source: img, width: img.naturalWidth, height: img.naturalHeight, release })
    }
    img.onerror = () => {
      release()
      reject(
        new ImageError('decode_failed', '画像を読み込めませんでした(対応していない形式の可能性があります)'),
      )
    }
    img.src = url
  })
}

// ---------------------------------------------------------------------------
// リサイズ + JPEG エンコード
// ---------------------------------------------------------------------------

function drawToJpeg(
  source: CanvasImageSource,
  width: number,
  height: number,
  quality: number,
): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new ImageError('decode_failed', '画像を処理できませんでした(canvas を利用できません)')

  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  // 透過PNG → JPEG で透明部分が黒く潰れないよう白で下地を塗る
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(source, 0, 0, width, height)

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob && blob.size > 0) resolve(blob)
        else reject(new ImageError('decode_failed', '画像を保存用に変換できませんでした'))
      },
      PHOTO_MIME_TYPE,
      quality,
    )
  })
}

// ---------------------------------------------------------------------------
// 表示用の ObjectURL
// ---------------------------------------------------------------------------

/**
 * 保存済みの写真を `<img src>` で表示するための URL を作る。
 *
 * **必ず対になる revokePhotoObjectUrl() を呼ぶこと**(呼ばないとページを
 * 閉じるまで画像がメモリに残る)。React では
 * `useEffect(() => { const url = createPhotoObjectUrl(photo); setUrl(url);
 *  return () => revokePhotoObjectUrl(url) }, [vehicle.photoUpdatedAt])`
 * のように、`photoUpdatedAt` をキーにして作り直す。
 */
export function createPhotoObjectUrl(photo: { blob: Blob }): string {
  return URL.createObjectURL(photo.blob)
}

/** createPhotoObjectUrl で作った URL を解放する(null/空文字は無視) */
export function revokePhotoObjectUrl(url: string | null | undefined): void {
  if (url) URL.revokeObjectURL(url)
}
