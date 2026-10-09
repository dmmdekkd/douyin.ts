# watch 播放

视频/播放类：弹幕、播放进度、观看记录与历史、安全等级。

## 弹幕

`bot.watch.danmaku(itemId, options?)` — 拉取作品某时间段弹幕。

```ts
const list = await bot.watch.danmaku(itemId, { startTime: 0, endTime: 10000 })
// [{ id, itemId, userId, offsetTime, text, diggCount, showDigg }]
```

### 参数

| 参数 | 类型 | 说明 |
|------|------|------|
| itemId | string | 作品 id |
| groupId | string | 弹幕分组 id，缺省等于 itemId |
| startTime | number | 起始毫秒偏移 |
| endTime | number | 结束毫秒偏移 |
| duration | number | 视频总时长（毫秒） |
| token | string | 认证 token（一般留空） |

## 播放进度

`bot.watch.progress(itemId, progress, duration)` — 上报播放进度，服务端据此续播/记历史。

```ts
await bot.watch.progress(itemId, 3000, 60000)
```

## 短剧观看记录

`bot.watch.series(seriesId, itemId, episode)` — 短剧剧集观看记录。

```ts
await bot.watch.series(seriesId, itemId, 3)
```

## 合集观看记录

`bot.watch.mix(mixId, itemId, episode)` — 合集观看记录。

```ts
await bot.watch.mix(mixId, itemId, 2)
```

## 写入观看历史

`bot.watch.history(awemeId, options?)` — 写入观看历史。

```ts
await bot.watch.history(awemeId, { authorId })
```

### 参数

| 参数 | 类型 | 说明 |
|------|------|------|
| awemeId | string | 作品 id |
| authorId | string | 作者数字 uid |
| preItemId | string | 上一条作品 id，空表示首次写入 |

## 作品安全等级

`bot.watch.safety(itemIds)` — 批量查作品安全等级（HAR 样本 result 为空，非空结构原样透传）。

```ts
const result = await bot.watch.safety([itemId])
// Array<Record<string, unknown>>
```