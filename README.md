# douyin.ts

抖音 IM 开发 SDK。TypeScript 7 · 纯 ESM · Node ≥ 20。

完整文档：<https://dmmdekkd.github.io/douyin.ts/>

支持：扫码登录（含短信/密码/滑块等二次验证）、收消息（WS 推送）、发消息（HTTP 通道）、富媒体上传、好友/群管理、会话状态与群事件。

## 安装

```bash
pnpm add douyin.ts
# 或 npm install douyin.ts
```

## 快速开始

```ts
import { login, Bot } from 'douyin.ts'

// 第一步：扫码登录
// QR 串由调用方渲染；二次验证（滑块/短信/密码）通过回调交付
const session = await login({
  onQr: qr => renderQr(qr.url),          // QR 串（扫码页 URL + base64 图）
  onStatus: s => console.log(s),         // new / scanned / verifying / confirmed...
  onVerifyUrl: url => open(url),         // 滑块等本地安全验证页
  onMfa: async info => getcode(info),    // 短信/密码二次验证输入
})
// session: { userId, cookie, userData? } —— 自行持久化，下次直接重建 Bot

// 第二步：用会话创建 Bot（已有 Cookie 时也可 new Bot({ cookie }) 直接接入）
const bot = new Bot(session)

bot.on('message', async msg => {
  if (msg.text === 'hi') await bot.msg.send(msg.chatId, { text: 'hello' })
})

await bot.start()
```

## 会话持久化

`login` 不做任何落盘，`session.cookie` 是唯一凭据。重启后复用同一 Cookie 可免扫码：

```ts
import { writeFile, readFile } from 'node:fs/promises'

// 首次登录后保存
await writeFile('session.json', JSON.stringify(session))

// 下次直接加载（Cookie 长期有效；失效则回到 login 重新扫码）
const session = JSON.parse(await readFile('session.json', 'utf8'))
const bot = new Bot(session)
await bot.start()
```

## 消息模型

`bot.on('message')` 的 `msg.content` 按类型判别（[`MsgBody`](src/im/types.ts)）：

| 类型 | 说明 |
|------|------|
| `text` | 文本（含 @ 提及，`msg.content.ats`） |
| `image` / `video` / `file` / `audio` / `emoji` | 媒体，`content` 内为可下载资源（视频需 `bot.media.videoUrl` 换播放地址） |
| `link` / `userCard` / `share` / `forward` / `chains` / `card` / `groupCard` / `location` | 各类卡片 |

注意：媒体消息的 `text` 只保留内容原生文案，无文案时为空字符串，**不预填「[视频]」等占位**；展示时请按 `type` 自行处理，避免与外部追加文案重复。

```ts
bot.on('message', async msg => {
  switch (msg.content.type) {
    case 'text':   return bot.msg.send(msg.chatId, { text: `你说：${msg.content.text}` })
    case 'image':  return bot.msg.send(msg.chatId, { text: '收到一张图' })
    case 'video':  return bot.msg.send(msg.chatId, { text: '收到一个视频' })
    default:       return bot.msg.send(msg.chatId, { text: `收到 ${msg.content.type}` })
  }
})
```

## 事件

统一 `bot.on(event, fn)`：

| 事件 | 载荷 | 说明 |
|------|------|------|
| `message` | `BotMessage` | 新消息（含 `chatId`） |
| `message:edited` | `BotMessage` | 消息被编辑（重推全文） |
| `notice` | `NoticeEvent` | 会话变更通知，按 `type` 细分 |
| `request` | `RequestEvent` | 好友/入群申请 |
| `voip` | `VoipCallEvent` | 语音来电 |
| `read` | `ReadEvent` | 单聊已读回执 |
| `status` | `StatusEvent` | 高频会话状态（成员增减明细、会话属性变更） |
| `reconnecting` / `close` | `WsReconnectEvent` / `WsCloseEvent` | 连接生命周期 |

`notice` 子类型（`msg.type`）：`group.member-increase` / `group.member-decrease` / `group.admin` / `group.name-change` / `group.avatar-change` / `group.dismiss` / `friend.increase` / `friend.decrease` / `message.recall` / `message.reaction` / `conversation.delete` / `conversation.read` / `conversation.typing` / `im.command` …

```ts
bot.on('notice', async notice => {
  if (notice.type === 'group.member-increase') {
    console.log(`群 ${notice.conversationId} 加入 ${notice.members.map(m => m.uid).join(', ')}`)
  }
})
```

## API（统一 `bot.域.动作`）

| 域 | 动作 | 说明 |
|----|------|------|
| msg | send / edit / reply / media / forward / recall / react / read | 发消息、引用回复、富媒体、合并转发、撤回、表情回应、已读 |
| media | image / video / file / videoUrl | 媒体上传与视频地址换取 |
| frd | list / requests / approve / reject | 好友列表与申请处理 |
| grp | list / members / requests / approve / reject / rename | 群列表、成员、入群申请、群名 |
| chat | history / strangers | 历史消息、陌生人列表 |
| user | self | 自身资料 |

```ts
// 发文本
await bot.msg.send(chatId, { text: 'hi' })
// 发图文
const img = await bot.media.image(data)
await bot.msg.send(chatId, { image: img, text: '看这个' })
// 引用回复
await bot.msg.reply(chatId, msg, '收到')
// 撤回
await bot.msg.recall(chatId, msgId)
```

## 配置

```ts
new Bot({
  cookie: string          // 登录 Cookie（login 返回或已登录浏览器复制）
  userId?: string         // 自身数字 uid，省略自动获取
  userAgent?: string      // 默认桌面 UA
  timeout?: number        // 请求超时毫秒，默认 30000
  log?: Log               // 自定义日志，默认内置彩色日志
})
```

## 登录二次验证

触发短信/密码验证时，`login` 需要 `onMfa` 回调返回验证码/密码；未提供且服务端无免输入方式（上行短信）时登录会失败，请在调用处接入交互输入。