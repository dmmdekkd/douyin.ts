import { defineConfig } from 'vitepress'

export default defineConfig({
  base: '/douyin.ts/',
  lang: 'zh-CN',
  title: 'douyin.ts',
  description: '抖音 IM 开发 SDK · TypeScript 7 · 纯 ESM',
  themeConfig: {
    nav: [
      { text: '指南', link: '/guide/', activeMatch: '/guide/' },
      { text: 'API', link: '/api/msg', activeMatch: '/api/' },
    ],
    sidebar: {
      '/guide/': [
        {
          text: '指南',
          items: [
            { text: '快速开始', link: '/guide/' },
            { text: '登录', link: '/guide/login' },
            { text: '消息与事件', link: '/guide/message' },
            { text: '配置', link: '/guide/config' },
          ],
        },
      ],
      '/api/': [
        {
          text: 'API',
          items: [
            { text: 'msg 消息', link: '/api/msg' },
            { text: 'media 媒体', link: '/api/media' },
            { text: 'frd 好友', link: '/api/frd' },
            { text: 'grp 群', link: '/api/grp' },
            { text: 'chat 会话', link: '/api/chat' },
            { text: 'user 用户', link: '/api/user' },
          ],
        },
      ],
    },
    outline: 'deep',
    docFooter: { prev: '上一篇', next: '下一篇' },
    lastUpdated: { text: '最后更新' },
  },
})
