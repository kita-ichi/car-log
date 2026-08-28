/**
 * 24pxストロークSVGアイコン(デザインガイド §7: 絵文字は使わない・線画で統一)
 * 色は currentColor に従う(文脈のテキスト色)。
 */
import type { VehicleType } from '../types/models'

interface IconProps {
  size?: number
  strokeWidth?: number
  className?: string
}

const Svg = ({
  size = 24,
  strokeWidth = 2,
  className,
  children,
}: IconProps & { children: React.ReactNode }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    {children}
  </svg>
)

/** 車(デザインガイド 5.12) */
export const CarIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 11l1.6-4.5A2 2 0 0 1 8.5 5h7a2 2 0 0 1 1.9 1.5L19 11" />
    <rect x="3" y="11" width="18" height="5" rx="1.5" />
    <circle cx="7.5" cy="17.5" r="1.5" />
    <circle cx="16.5" cy="17.5" r="1.5" />
  </Svg>
)

/** バイク(デザインガイド 5.12) */
export const BikeIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="5" cy="16" r="3" />
    <circle cx="19" cy="16" r="3" />
    <path d="M7.5 14h5l4-4H6" />
    <path d="M8.5 14l4-4" />
    <path d="M13 6h2l1.5 3 2 4" />
  </Svg>
)

/** 車両タイプに応じた車/バイクアイコン */
export const VehicleIcon = ({ type, ...p }: IconProps & { type: VehicleType }) =>
  type === 'motorcycle' ? <BikeIcon {...p} /> : <CarIcon {...p} />

/** 燃料(ドロップ) */
export const FuelIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 2.7l5.66 5.66a8 8 0 1 1-11.31 0z" />
  </Svg>
)

/** 工具(メンテ) */
export const WrenchIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
  </Svg>
)

/** ホーム */
export const HomeIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <path d="M9 22V12h6v10" />
  </Svg>
)

/** 設定(スライダー) */
export const SettingsIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />
  </Svg>
)

/** + */
export const PlusIcon = (p: IconProps) => (
  <Svg strokeWidth={2.5} {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
)

/** ✕(キャンセル) */
export const CloseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M18 6L6 18M6 6l12 12" />
  </Svg>
)

/** ←(戻る) */
export const BackIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M19 12H5M12 19l-7-7 7-7" />
  </Svg>
)

/** 下向きシェブロン(車両チップ) */
export const ChevronDownIcon = (p: IconProps) => (
  <Svg strokeWidth={2.5} {...p}>
    <path d="M6 9l6 6 6-6" />
  </Svg>
)

/** 右向きシェブロン(リスト行) */
export const ChevronRightIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 18l6-6-6-6" />
  </Svg>
)

/** チェックマーク(選択中) */
export const CheckIcon = (p: IconProps) => (
  <Svg strokeWidth={3} {...p}>
    <path d="M20 6L9 17l-5-5" />
  </Svg>
)

/** 写真(枠+山と丸の線画。デザインガイド 5.15) */
export const PhotoIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2.5" />
    <circle cx="8.5" cy="9.5" r="1.5" />
    <path d="M21 16l-5-5-9 9" />
  </Svg>
)

/** 拡縮(斜め両矢印 ⤢。写真の調整 S-08a。デザインガイド 5.15.5) */
export const ExpandIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M15 3h6v6M21 3l-7 7" />
    <path d="M9 21H3v-6M3 21l7-7" />
  </Svg>
)

/** 拡大(＋の虫めがね。写真の大きさスライダーの＋側) */
export const ZoomInIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="M11 8v6M8 11h6M20 20l-3.6-3.6" />
  </Svg>
)

/** 縮小(−の虫めがね。写真の大きさスライダーの−側) */
export const ZoomOutIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="M8 11h6M20 20l-3.6-3.6" />
  </Svg>
)

/** ダウンロード(エクスポート) */
export const DownloadIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
  </Svg>
)
