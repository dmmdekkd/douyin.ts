import { defineConfig } from 'vitepress'
import type { BackToTopOptions } from './theme/backToTop'
import { socialIcons } from './theme/icons'

// themeConfig 以变量声明，自定义字段 backToTop 结构兼容透传
const themeConfig = {
  logo: '/logo.webp',
  nav: [
    { text: '指南', link: '/guide/', activeMatch: '/guide/' },
    { text: '事件', link: '/events/message', activeMatch: '/events/' },
    { text: 'API', link: '/api/msg', activeMatch: '/api/' },
  ],
  sidebar: {
    '/guide/': [
      {
        text: '指南',
        items: [
          { text: '快速开始', link: '/guide/' },
          { text: '登录', link: '/guide/login' },
          { text: '消息', link: '/guide/message' },
          { text: '配置', link: '/guide/config' },
        ],
      },
    ],
    '/events/': [
      {
        text: '事件',
        items: [
          { text: 'message', link: '/events/message' },
          { text: 'notice', link: '/events/notice' },
          { text: 'request', link: '/events/request' },
          { text: 'voip', link: '/events/voip' },
          { text: 'read', link: '/events/read' },
          { text: 'status', link: '/events/status' },
          { text: 'connection', link: '/events/connection' },
        ],
      },
    ],
    '/api/': [
      {
        text: 'API',
        items: [
          { text: 'msg 消息', link: '/api/msg' },
          { text: 'media 媒体', link: '/api/media' },
          { text: 'sticker 表情', link: '/api/sticker' },
          { text: 'frd 好友', link: '/api/frd' },
          { text: 'grp 群', link: '/api/grp' },
          { text: 'chat 会话', link: '/api/chat' },
          { text: 'user 用户', link: '/api/user' },
        ],
      },
    ],
  },
  socialLinks: [
    { icon: { svg: socialIcons.github }, link: 'https://github.com/dmmdekkd/douyin.ts', ariaLabel: 'GitHub' },
    { icon: { svg: socialIcons.npm }, link: 'https://www.npmjs.com/package/douyin.ts', ariaLabel: 'npm' },
    { icon: { svg: socialIcons.douyin }, link: 'https://www.douyin.com/user/MS4wLjABAAAAC94yjqHIIjjYNiiihc1tLMEsTe4z74SUUoThvTw1j3qbu9L972pDgQj4WhaxrnFA', ariaLabel: '抖音' },
    { icon: { svg: socialIcons.bilibili }, link: 'https://space.bilibili.com/1234796277', ariaLabel: '哔哩哔哩' },
  ],
  search: {
    provider: 'local' as const,
    options: {
      translations: {
        button: { buttonText: '搜索文档', buttonAriaLabel: '搜索文档' },
        modal: {
          noResultsText: '未找到相关结果',
          resetButtonTitle: '清空关键词',
          footer: { selectText: '选择', navigateText: '切换', closeText: '关闭' },
        },
      },
    },
  },
  editLink: {
    pattern: 'https://github.com/dmmdekkd/douyin.ts/edit/main/:path',
    text: '在 GitHub 上编辑此页',
  },
  lightModeSwitchTitle: '切换到亮色模式',
  darkModeSwitchTitle: '切换到暗色模式',
  footer: {
    message: '基于 MIT 许可发布',
    copyright: 'Copyright © 2026 dmmdekkd',
  },
  notFound: {
    code: '404',
    title: '哎呀，页面走丢了',
    quote: '迷路了吗？别担心，即使方向不对，只要坚持寻找，终会找到属于你的那条路。',
    linkLabel: '返回导航',
    linkText: '带我回家',
  },
  outline: {
    level: 2,
    label: '本页内容',
  },
  // 回到顶部按钮外观（缺省即默认值）
  backToTop: {
    bottom: 80,
    right: 24,
    iconSize: 20,
    duration: 600,
  } satisfies BackToTopOptions,
  darkModeSwitchLabel: '外观',
  sidebarMenuLabel: '目录',
  returnToTopLabel: '回到顶部',
  docFooter: { prev: '上一篇', next: '下一篇' },
  lastUpdated: { text: '最后更新' },
  // 当前文档对应的 SDK 版本，GitHub 最新 Release 高于它时弹新版本公告
  currentVersion: '0.1.0',
}

export default defineConfig({
  base: '/douyin.ts/',
  lang: 'zh-CN',
  title: 'douyin.ts',
  description: '抖音 IM 机器人 SDK · TypeScript 7 · 纯 ESM',
  head: [['link', { rel: 'icon', type: 'image/webp', href: '/douyin.ts/logo.webp' }]],
  themeConfig,
})