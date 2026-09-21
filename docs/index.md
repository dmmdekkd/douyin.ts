---
layout: home

hero:
  name: douyin.ts
  text: 抖音 IM 开发 SDK
  tagline: TypeScript 7 · 纯 ESM · 零框架依赖
  actions:
    - theme: brand
      text: 快速开始
      link: /guide/
    - theme: alt
      text: API 参考
      link: /api/msg

features:
  - title: 扫码登录
    details: QR 串渲染权归调用方；本地安全验证、短信/密码二次验证通过回调交付，session 自行保存
  - title: 收发双通道
    details: 收消息走 Android Frontier WS 推送，发消息统一 HTTP cookie 通道，HTTP 同时承担收件箱查询与媒体上传
  - title: 统一 API
    details: bot.域.动作 两级结构（msg / media / frd / grp / chat / user），chatId 不透明串贯穿，事件统一 bot.on
  - title: 会话不持久化
    details: SDK 不落盘任何东西，Cookie 与设备信息由调用方存储，便于嵌入你自己的账号体系
---
