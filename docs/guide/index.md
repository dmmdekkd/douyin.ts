# 快速开始

## 安装

```bash
pnpm add douyin.ts
```

要求 Node.js 20+。

## 最小示例

```ts
import { login, Bot } from 'douyin.ts'

const session = await login({
  onQr: qr => renderQr(qr.url),
  onVerifyUrl: url => open(url),
})

const bot = new Bot(session)
bot.on('message', async msg => {
  if (msg.text === 'hi') await bot.msg.send(msg.chatId, { type: 'text', text: 'hello' })
})
await bot.start()
```

## 三步模型

| 步骤 | 做什么 | 参考 |
|------|--------|------|
| 登录 | `login()` 拿 session（扫码/复用 Cookie） | [登录](/guide/login) |
| 构建 | `new Bot(session)` + `bot.on(...)` 注册事件 | [配置](/guide/config) |
| 启动 | `await bot.start()`，收发消息与查询 | [消息与事件](/guide/message) |

## API 形态

统一 `bot.域.动作`，两级结构：

| 域 | 动作 |
|----|------|
| msg | send / reply / recall / react / read / edit |
| media | image / video / file / videoUrl / emojiList |
| sticker | list / favs / gifs / collect / trending |
| frd | list / follows / fans / mutual / requests / approve / reject |
| grp | list / members / requests / approve / reject / rename / addMembers / removeMembers / leave / create |
| chat | history / info / readIndex / minIndex / delete / setting / batchReadIndex |
| user | self / profileScene / profileOther / onlineStatus |

完整签名见 [API 参考](/api/msg)。