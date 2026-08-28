/**
 * 車両リポジトリ(§5.1 Vehicle / S-08 車両管理)
 * - 削除APIは提供しない。手放した車両は archive() で非表示にする(記録は保持)
 * - 愛車の写真(F-22)は別テーブル `vehiclePhotos` に保存し、Vehicle 本体には
 *   `photoUpdatedAt`(写真の有無・更新時刻)だけを持たせる。
 *   一覧(listActive / listAll)で画像バイト列を読まないための分離。
 */
import { db, type AppDatabase } from '../database'
import type { FuelType, PhotoAdjust, Vehicle, VehiclePhoto, VehicleType } from '../../types/models'
import {
  MAX_PHOTO_ZOOM,
  MIN_PHOTO_ZOOM,
  isDefaultPhotoAdjust,
  normalizePhotoAdjust,
} from '../../logic/photoAdjust'
import { assertNumber, newId, nowIso, stripAbsent, toUpdatePatch } from './helpers'

/**
 * 保存する写真。`ui/imageProcessing.ts` の `processVehiclePhoto()` の戻り値を
 * そのまま渡せる形(余分なプロパティがあっても保存対象は下記のみ)。
 */
export interface VehiclePhotoInput {
  /** リサイズ・圧縮済みの画像(logic/image.ts の方針で長辺1280pxのJPEG) */
  blob: Blob
  /** 省略時は blob.type(それも空なら 'image/jpeg') */
  mimeType?: string
  width?: number
  height?: number
}

/**
 * 写真の指定方法(create / update 共通)。
 * - `Blob`(または `File`)/ `VehiclePhotoInput` = 設定・差し替え
 * - `null` = 写真を削除
 * - `undefined`(キー省略)= 変更なし
 */
export type PhotoAssignment = Blob | VehiclePhotoInput | null

/**
 * 写真の表示調整(F-22b)の指定方法。
 * - `PhotoAdjust` = その値にする(範囲外・壊れた値はエラー)
 * - `null` = 既定値(cover + center)に戻す
 * - `undefined`(キー省略)= 変更なし。ただし **`photo` を同時に指定した場合は
 *   既定値にリセットされる**(前の写真の構図が別の写真に乗ると必ず破綻するため)
 */
export type PhotoAdjustAssignment = PhotoAdjust | null

/** 車両の新規登録入力(id・タイムスタンプ・アーカイブ状態は自動付与) */
export interface VehicleInput {
  name: string
  /** 省略時 'car' */
  vehicleType?: VehicleType
  /** 省略時 'regular' */
  fuelType?: FuelType
  /** 任意項目。未設定は省略または null */
  initialOdo?: number | null
  maker?: string | null
  model?: string | null
  firstRegistrationYm?: string | null
  tankCapacity?: number | null
  inspectionExpiry?: string | null
  /** 愛車の写真(F-22)。登録と同時に設定する場合のみ指定 */
  photo?: PhotoAssignment
  /** 写真の表示調整(F-22b)。省略時は既定値(cover + center) */
  photoAdjust?: PhotoAdjustAssignment
}

/**
 * 編集可能なフィールド(id・createdAt は変更不可)。
 * 任意項目(initialOdo / maker / model / firstRegistrationYm / tankCapacity / inspectionExpiry)は
 * null 指定で「クリア(値の削除)」、undefined(キー省略)で「変更なし」(§update系の共通契約)。
 *
 * 写真は `photo` で指定する(Blob = 設定・差し替え / null = 削除 / 省略 = 変更なし)。
 * `photoUpdatedAt` はリポジトリが自動で維持するため直接更新できない。
 */
export type VehicleUpdate = Partial<
  Omit<
    Vehicle,
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'initialOdo'
    | 'maker'
    | 'model'
    | 'firstRegistrationYm'
    | 'tankCapacity'
    | 'inspectionExpiry'
    | 'photoUpdatedAt'
    | 'photoAdjust'
  >
> & {
  initialOdo?: number | null
  maker?: string | null
  model?: string | null
  firstRegistrationYm?: string | null
  tankCapacity?: number | null
  inspectionExpiry?: string | null
  photo?: PhotoAssignment
  photoAdjust?: PhotoAdjustAssignment
}

/**
 * null 指定で「キー削除」扱いにする任意項目。
 * photoUpdatedAt は UI からは直接指定できないが、写真削除時に内部で null を渡して
 * キーごと消すため同じ仕組みに載せている。
 */
const CLEARABLE_KEYS = [
  'initialOdo',
  'maker',
  'model',
  'firstRegistrationYm',
  'tankCapacity',
  'inspectionExpiry',
  'photoUpdatedAt',
  // 既定値(cover + center)は「キーを持たない」で表す。DB上の「調整なし」を1通りに保つ
  'photoAdjust',
] as const

/**
 * create / update 入口の不変条件チェック(§6.1 不正データはこの層で弾く)。
 * undefined のフィールドは「未指定」としてチェックしない(update の変更なし)。
 */
function assertVehicleValues(values: {
  name?: string
  initialOdo?: number | null
  tankCapacity?: number | null
  photoAdjust?: PhotoAdjustAssignment
}): void {
  if (values.name !== undefined && values.name.trim() === '') {
    throw new Error('name(車両名)は空にできません')
  }
  assertNumber('initialOdo', values.initialOdo, { min: 0, nullable: true }) // 未設定可・null=クリア可。設定時は0以上
  assertNumber('tankCapacity', values.tankCapacity, { greaterThan: 0, nullable: true }) // null=クリア可
  assertPhotoAdjust(values.photoAdjust)
}

/**
 * 表示調整の値域チェック(§6.1)。
 *
 * UI は保存前に `clampPhotoAdjust()`(logic/photoAdjust.ts)を通す約束なので、
 * ここに範囲外の値が来るのは呼び出し側のバグ。**黙って丸めず throw する**
 * (他の任意項目と同じ扱い)。
 */
function assertPhotoAdjust(value: PhotoAdjustAssignment | undefined): void {
  if (value === undefined || value === null) return
  if (typeof value !== 'object') throw new Error('photoAdjust はオブジェクトで指定してください')
  assertNumber('photoAdjust.zoom', value.zoom, { min: MIN_PHOTO_ZOOM })
  assertNumber('photoAdjust.focusX', value.focusX, { min: 0 })
  assertNumber('photoAdjust.focusY', value.focusY, { min: 0 })
  if (value.zoom > MAX_PHOTO_ZOOM) {
    throw new Error(`photoAdjust.zoom は ${MAX_PHOTO_ZOOM} 以下で指定してください: ${value.zoom}`)
  }
  for (const axis of ['focusX', 'focusY'] as const) {
    if (value[axis] > 1) {
      throw new Error(`photoAdjust.${axis} は 0〜1 で指定してください: ${value[axis]}`)
    }
  }
}

/**
 * 保存する調整値へ変換する。
 * 既定値(= 調整なし)は **null** にして、キーを持たない状態で保存させる
 * (「調整なし」の表し方をDB上で1通りに保ち、旧データと同じ形にする)。
 */
function toStoredAdjust(value: PhotoAdjustAssignment | undefined): PhotoAdjust | null | undefined {
  if (value === undefined) return undefined // 変更なし
  if (value === null || isDefaultPhotoAdjust(value)) return null // キー削除
  return normalizePhotoAdjust(value) // 桁数を丸めて保存
}

/** vehicles テーブルに書き込むフィールド群(photo は別テーブルなので含まない) */
type VehicleFieldPatch = Omit<VehicleUpdate, 'photo'> & {
  updatedAt: string
  /** null = 写真なしにする(キー削除)。undefined = 変更なし */
  photoUpdatedAt?: string | null
}

/** 「写真あり」の車両にだけ表示調整を保存できる(写真が無ければ適用先が無い) */
function assertHasPhoto(vehicle: Vehicle | undefined, id: string): Vehicle {
  if (!vehicle) throw new Error(`車両が見つかりません: ${id}`)
  if (vehicle.photoUpdatedAt === undefined) {
    throw new Error('写真が設定されていない車両には表示調整を保存できません')
  }
  return vehicle
}

/**
 * 写真の指定(Blob / VehiclePhotoInput)を保存レコードへ変換する。
 * リサイズ・圧縮は UI 層(ui/imageProcessing.ts)で済ませてから渡すこと。
 */
function toPhotoRecord(
  vehicleId: string,
  photo: Blob | VehiclePhotoInput,
  updatedAt: string,
): VehiclePhoto {
  const input: VehiclePhotoInput = photo instanceof Blob ? { blob: photo } : photo
  const blob = input?.blob
  if (!(blob instanceof Blob)) throw new Error('photo には Blob(または { blob } )を指定してください')
  if (blob.size === 0) throw new Error('photo が空です(0バイト)')
  return {
    vehicleId,
    blob,
    mimeType: input.mimeType || blob.type || 'image/jpeg',
    byteSize: blob.size,
    ...stripAbsent({ width: input.width, height: input.height }),
    updatedAt,
  }
}

export function createVehicleRepository(database: AppDatabase) {
  // 内部で他のメソッドを呼ぶ箇所があるため this ではなく変数経由で参照する
  // (`const { setPhoto } = vehicleRepository` のように取り出しても壊れないように)
  const repository = {
    /** 車両を登録して登録後のエンティティを返す */
    async create(input: VehicleInput): Promise<Vehicle> {
      assertVehicleValues(input)
      const now = nowIso()
      // 写真ありなら先にレコード化して検証を通す(不正な blob で車両だけ作られるのを防ぐ)
      const photo = input.photo ? toPhotoRecord('', input.photo, now) : null
      const vehicle: Vehicle = {
        id: newId(),
        createdAt: now,
        updatedAt: now,
        isArchived: false,
        vehicleType: input.vehicleType ?? 'car',
        fuelType: input.fuelType ?? 'regular',
        name: input.name,
        ...stripAbsent({
          initialOdo: input.initialOdo,
          maker: input.maker,
          model: input.model,
          firstRegistrationYm: input.firstRegistrationYm,
          tankCapacity: input.tankCapacity,
          inspectionExpiry: input.inspectionExpiry,
          photoUpdatedAt: photo ? now : undefined,
          // 写真が無ければ調整値も持たせない(適用先が無い値を残さない)
          photoAdjust: photo ? toStoredAdjust(input.photoAdjust) : undefined,
        }),
      }
      if (!photo) {
        await database.vehicles.add(vehicle)
        return vehicle
      }
      // 車両行と写真行は必ずセットで入る(片方だけ残らないよう1トランザクション)
      await database.transaction('rw', database.vehicles, database.vehiclePhotos, async () => {
        await database.vehicles.add(vehicle)
        await database.vehiclePhotos.put({ ...photo, vehicleId: vehicle.id })
      })
      return vehicle
    },

    async getById(id: string): Promise<Vehicle | undefined> {
      return database.vehicles.get(id)
    },

    /** アーカイブ済みを除いた車両一覧(登録順)。S-08 / S-11 用 */
    async listActive(): Promise<Vehicle[]> {
      const all = await database.vehicles.toArray()
      return all
        .filter((v) => !v.isArchived)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    },

    /** アーカイブ済みを含む全車両(エクスポート用) */
    async listAll(): Promise<Vehicle[]> {
      const all = await database.vehicles.toArray()
      return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    },

    /**
     * 車両情報を更新して更新後のエンティティを返す。
     * `photo` を指定した場合は写真テーブルも同じトランザクションで更新する
     * (Blob = 設定・差し替え / null = 削除 / キー省略 = 変更なし)。
     */
    async update(id: string, patch: VehicleUpdate): Promise<Vehicle> {
      assertVehicleValues(patch)
      const { photo, photoAdjust, ...fields } = patch
      const now = nowIso()

      const applyFields = async (): Promise<void> => {
        const fieldPatch: VehicleFieldPatch = { ...fields, updatedAt: now }
        // 写真を差し替えたら photoUpdatedAt も更新、削除なら null(= キー削除)
        if (photo !== undefined) fieldPatch.photoUpdatedAt = photo === null ? null : now
        // 写真を差し替え・削除したら調整値は既定に戻す(前の写真の構図は引き継がない)。
        // 新しい写真の調整値を同時に渡された場合はそちらを優先する
        fieldPatch.photoAdjust =
          photoAdjust !== undefined ? toStoredAdjust(photoAdjust) : photo !== undefined ? null : undefined
        // null=クリア / undefined=変更なし の契約を Dexie パッチへ変換
        const changes = toUpdatePatch<VehicleFieldPatch>(fieldPatch, CLEARABLE_KEYS) as Partial<Vehicle>
        const updated = await database.vehicles.update(id, changes)
        if (updated === 0) throw new Error(`車両が見つかりません: ${id}`)
      }

      if (photo === undefined) {
        await applyFields()
        return (await database.vehicles.get(id))!
      }

      // 写真の差し替え・削除は不正な blob を先に弾いてからDBに触る
      const record = photo === null ? null : toPhotoRecord(id, photo, now)
      return database.transaction('rw', database.vehicles, database.vehiclePhotos, async () => {
        await applyFields()
        if (record) await database.vehiclePhotos.put(record)
        else await database.vehiclePhotos.delete(id)
        return (await database.vehicles.get(id))!
      })
    },

    // -----------------------------------------------------------------------
    // 愛車の写真(F-22)
    // -----------------------------------------------------------------------

    /**
     * 車両の写真を取得する(未設定なら undefined)。
     * **画像を表示するときだけ呼ぶこと** — 写真の有無だけなら
     * `vehicle.photoUpdatedAt` で判定できるので、この呼び出しは不要。
     */
    async getPhoto(vehicleId: string): Promise<VehiclePhoto | undefined> {
      return database.vehiclePhotos.get(vehicleId)
    },

    /**
     * 複数車両の写真をまとめて取得する(S-08 の一覧サムネイル・S-11 の切り替えシート用)。
     * 写真が無い車両はキーごと結果に含まれない。
     *
     * 一覧で1行ずつ `getPhoto()` を呼ぶより往復が減る。渡すのは
     * **実際に表示する行の車両IDだけ**にすること(全車両を無条件に読まない)。
     */
    async getPhotos(vehicleIds: readonly string[]): Promise<Map<string, VehiclePhoto>> {
      if (vehicleIds.length === 0) return new Map()
      const found = await database.vehiclePhotos.bulkGet([...vehicleIds])
      return new Map(
        found.filter((photo): photo is VehiclePhoto => photo !== undefined).map((p) => [p.vehicleId, p]),
      )
    },

    /** 写真を設定・差し替える(既存があれば上書き)。更新後の車両を返す */
    async setPhoto(vehicleId: string, photo: Blob | VehiclePhotoInput): Promise<Vehicle> {
      return repository.update(vehicleId, { photo })
    },

    /** 写真を削除する(車両は残る)。更新後の車両を返す */
    async removePhoto(vehicleId: string): Promise<Vehicle> {
      return repository.update(vehicleId, { photo: null })
    },

    /**
     * 写真の表示調整(F-22b)を保存する。更新後の車両を返す。
     *
     * - 値は `clampPhotoAdjust()`(logic/photoAdjust.ts)で範囲内にしてから渡すこと。
     *   範囲外・壊れた値は throw する
     * - 既定値(cover + center)と同じ値を渡すと**調整なしの状態に戻る**
     *   (`resetPhotoAdjust()` と同じ結果)
     * - **`photoUpdatedAt` は変えない**。画像バイト列は変わっていないので、
     *   UI の ObjectURL を作り直させない(位置合わせのたびに画像を読み直さない)
     *
     * @throws 車両が無い場合・写真が設定されていない場合
     */
    async setPhotoAdjust(vehicleId: string, adjust: PhotoAdjustAssignment): Promise<Vehicle> {
      assertPhotoAdjust(adjust)
      assertHasPhoto(await database.vehicles.get(vehicleId), vehicleId)
      return repository.update(vehicleId, { photoAdjust: adjust })
    },

    /** 表示調整を既定値(cover + center)に戻す。更新後の車両を返す */
    async resetPhotoAdjust(vehicleId: string): Promise<Vehicle> {
      return repository.setPhotoAdjust(vehicleId, null)
    },

    /** 全車両の写真(エクスポート用・F-11)。車両IDの昇順 */
    async listAllPhotos(): Promise<VehiclePhoto[]> {
      const all = await database.vehiclePhotos.toArray()
      return all.sort((a, b) => a.vehicleId.localeCompare(b.vehicleId))
    },

    /**
     * 写真の枚数と合計バイト数(S-09 のバックアップ画面で
     * 「写真を含める(約◯MB)」を出すため)。画像バイト列は読み出さない。
     */
    async getPhotoStorageSummary(): Promise<{ count: number; totalBytes: number }> {
      let count = 0
      let totalBytes = 0
      await database.vehiclePhotos.each((photo) => {
        count++
        totalBytes += photo.byteSize ?? photo.blob?.size ?? 0
      })
      return { count, totalBytes }
    },

    /** 手放した車両を非表示にする(記録・写真は保持・復元可能) */
    async archive(id: string): Promise<void> {
      await repository.update(id, { isArchived: true })
    },

    /** アーカイブを解除する */
    async unarchive(id: string): Promise<void> {
      await repository.update(id, { isArchived: false })
    },
  }
  return repository
}

export type VehicleRepository = ReturnType<typeof createVehicleRepository>

/** アプリ本体で使うシングルトン */
export const vehicleRepository = createVehicleRepository(db)
