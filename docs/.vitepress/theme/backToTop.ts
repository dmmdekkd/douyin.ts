// 回到顶部按钮外观配置（config.mts themeConfig.backToTop）
export interface BackToTopOptions {
  /** 按钮直径 px */
  size?: number
  /** 圆角 px，>= 50 视为圆形 */
  radius?: number
  /** 背景色 */
  bg?: string
  /** hover 背景色 */
  hoverBg?: string
  /** 图标颜色 */
  color?: string
  /** 阴影 */
  shadow?: string
  /** 距底部 px */
  bottom?: number
  /** 距右侧 px */
  right?: number
  /** 图标大小 px */
  iconSize?: number
  /** 回顶滚动动画时长 ms */
  duration?: number
}