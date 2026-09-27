import DefaultTheme from 'vitepress/theme'
import { h } from 'vue'
import BackToTop from './BackToTop.vue'
import Contributors from './Contributors.vue'
import HeroIcon from './HeroIcon.vue'
import MyNavBarExtra from './MyNavBarExtra.vue'
import PageFade from './PageFade.vue'
import PanelTheme from './PanelTheme.vue'
import ReleaseBanner from './ReleaseBanner.vue'
import './custom.css'

export default {
  ...DefaultTheme,
  Layout: () =>
    // 页面切换时主内容淡入，包裹整页布局
    h(PageFade, null, {
      default: () =>
        h(DefaultTheme.Layout, null, {
          'layout-bottom': () => h(BackToTop),
          // VPNavBar 硬编码导入官方 VPNavBarExtra，无法键名覆盖，改走 content-after 插槽注入自研面板
          'nav-bar-content-after': () => h(MyNavBarExtra),
          // 移动端走汉堡抽屉（<768 无 ⋮ 面板）：品牌色归入底部设置区，外观/社交官方已内置
          'nav-screen-content-after': () => h(PanelTheme),
          // 侧边栏导航顶部注入新版本公告条（仅新版本发布时出现）
          'sidebar-nav-before': () => h(ReleaseBanner),
          // 首页 hero 右侧主视觉：品牌音符，替代默认空位（官方 has-image 布局生效）
          'home-hero-image': () => h(HeroIcon),
          // 每个文档页底部：贡献者圆形头像 + 名称（位于正文之后、上一页/下一页之前）
          'doc-footer-before': () => h(Contributors),
        }),
    }),
}