# media 媒体

媒体上传，输入支持 URL、本地路径、base64 或原始字节（`MediaInput`）。返回的 Asset 直接传给 `bot.msg.send`。

## 上传图片

`bot.media.image(input)` — 上传图片，返回图片资源（可作视频封面）。

```ts
const img = await bot.media.image(new Uint8Array(pngBytes))
await bot.msg.send(chatId, { type: 'image', image: img })
```

## 上传视频

`bot.media.video(input)` — 上传视频。封面与尺寸可选，缺省直接发送。

```ts
const video = await bot.media.video(new Uint8Array(mp4Bytes))
const poster = await bot.media.image(new Uint8Array(jpegBytes))
await bot.msg.send(chatId, { type: 'video', video: { asset: video, poster, width: 720, height: 1280 } })
// 不带封面：poster/width/height 全部省略即可
await bot.msg.send(chatId, { type: 'video', video: { asset: video } })
```

## 上传文件

`bot.media.file(input, name?)` — 上传文件。`name` 缺省从来源推断（路径/URL 取文件名）。

```ts
const f = await bot.media.file(new Uint8Array(bytes), '报表.xlsx')
await bot.msg.send(chatId, { type: 'file', file: f })
```

### 参数

| 参数 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| input | MediaInput | `URL` `路径` `base64` `字节` | 输入源，识别规则见下 |
| name | string | - | 文件名，缺省从来源推断 |

## 表情资源

`bot.media.emojiList()` — 官方表情资源全量映射（214 项）。`name` 即表情消息文本与 `react` 的键值，`urls` 为带签名时效的 CDN 直链。

```ts
const emojis = await bot.media.emojiList()
// { id: 'weixiao', name: '[微笑]', uri: 'tos-cn-i-0813/xxxx.png', urls: ['https://p3-...amemv.com/...'] }
```

## 视频播放地址

`bot.media.videoUrl(tkey)` — 消息视频的 tkey 换加密 CDN 地址。私信视频协议不直发播放 URL，只有 `tkey` 凭证。

视频消息事件下发前 SDK 自动换取加密 CDN 地址（`msg.video.url`）随事件下发，无需手动调用；过期后可调此方法重取。

```ts
bot.on('message', async msg => {
  if (msg.type !== 'video') return
  // msg.video.url: { mainUrl, backupUrl?, expireTime? }
})
```

### 参数

| 参数 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| tkey | string | - | 消息视频的 tkey 凭证 |

::: warning
地址指向 **CENC 加密流**，不能直接播放。缩略图可用视频的 `poster`（签名 URL）或 `inlinePic`（内置 base64，不过期）。
:::

### 视频解密

SDK 不代下载视频。拿到加密 mp4 字节后，用 `decryptCencMp4(data, keyHex)` 解密为可直接播放的 mp4，密钥即消息 `video.skey`：

```ts
import { decryptCencMp4 } from 'douyin.ts'

bot.on('message', async msg => {
  if (msg.type !== 'video') return
  const res = await fetch(msg.video.url!.mainUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  const mp4 = decryptCencMp4(new Uint8Array(await res.arrayBuffer()), msg.video.skey)
})
```

## 输入源识别规则

| 输入 | 判定 |
|------|------|
| `https://…` / `http://…` | 下载 |
| 磁盘上存在的路径 | 读文件 |
| 纯 base64 字符串（≥32 字符） | 解码 |
| `Uint8Array` / `Buffer` / `ArrayBuffer` | 原样使用 |

## 一步发送

`bot.msg.send` 的媒体字段可直接给输入源（URL / 路径 / base64 / 字节），SDK 内部自动上传归一化，无需先调 `media.*`：

```ts
// 图片：URL 直接发
await bot.msg.send(chatId, { type: 'image', image: 'https://example.com/cat.jpg' })

// 视频：source + 封面（尺寸缺省自动探测；不带封面则抽视频首帧作封面）
await bot.msg.send(chatId, { type: 'video', video: { source: 'D:/videos/cat.mp4', poster: 'D:/pictures/cat.jpg' } })

// 文件：可命名
await bot.msg.send(chatId, { type: 'file', file: { source: Buffer.from('内容'), name: 'test.txt' } })
```

预上传的 Asset 与输入源可混用（重复发送同一图时先上传一次更省流量）。

## 作品详情

`bot.media.awemeDetail(awemeIds, options?)` — 按 awemeId 批量拉作品详情（视频/图文）。返回摘要字段，完整结构在 `raw`。

```ts
const details = await bot.media.awemeDetail([awemeId], { conversationShortId })
// [{ awemeId, desc?, createTime?, playUrls?, coverUrls?, author?, raw }]
```

### 参数

| 参数 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| awemeIds | string[] | - | 作品 id 列表 |
| options.originType | string | `chat` | 来源，缺省 chat |
| options.requestSource | number | `3` | 请求来源，缺省 3 |
| options.conversationShortId | string | - | 会话短 id（消息对象自带） |

## CDN 节点调度

`bot.media.getPeer(req)` — 按文件信息调度 CDN 传输节点（vc-gate-edge `get_peer`）。

```ts
const peer = await bot.media.getPeer({ fileInfo: { vid: '...', file_type: 'dash' } })
// { status, fid, traceId, reqId, token, nodes, indexNum, countryCode, ispCode }
```

### 参数

| 参数 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| req.appId | number | `6383` | 应用 id，缺省 6383 |
| req.sid | number | `5` | 会话 id，缺省 5 |
| req.taskType | number | `1` | 任务类型，缺省 1 |
| req.fileInfo | object | - | 原样透传（vid / cdn_url / file_type / sfid 等） |