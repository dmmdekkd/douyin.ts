# 快速开始

## 安装

```bash
pnpm add douyin.ts
```

要求 Node.js 20+（原生 fetch / WebSocket）。

## 最小示例

```ts
import { login, Bot } from 'douyin.ts'

// 扫码登录：QR 串交给调用方渲染，二次验证通过回调交付
const session = await login({
  onQr: qr => renderQr(qr.url),
  onStatus: s => console.log(s),
  onVerifyUrl: url => open(url),
  onMfa: async info => getcode(info),
})

const bot = new Bot(session)

bot.on('message', async msg => {
  if (msg.text === 'hi') await bot.msg.send(msg.chatId, { text: 'hello' })
})

await bot.start()
```

## 三步模型

| 步骤 | 做什么 | 去哪看 |
|------|--------|--------|
| 登录 | `login()` 拿到 `{ userId, cookie, userData? }` | [登录](/guide/login) |
| 构建 | `new Bot(session)`，注册 `bot.on(...)` | [配置](/guide/config) |
| 启动 | `await bot.start()`，域方法收发 | [消息与事件](/guide/message) |

## API 总览

统一形态 `bot.域.动作`，两级结构：

| 域 | 动作 | 说明 |
|----|------|------|
| msg | send / reply / media / forward / recall / react / read | 发消息、引用回复、富媒体、合并转发、撤回、表情回应、已读 |
| media | image / video / file | 媒体上传 |
| frd | list / requests / approve / reject | 好友列表与申请处理 |
| grp | list / members / requests / approve / reject / rename | 群列表、成员、入群申请、群名 |
| chat | history / strangers | 历史消息、陌生人列表 |
| user | self | 自身资料 |
