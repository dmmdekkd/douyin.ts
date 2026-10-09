# notice 通知

通知分组未读数与通知列表（红点轮询）。

## 未读数

`bot.notice.count()` — 各通知分组未读数（401=互动，924=其他）。

```ts
const counts = await bot.notice.count()
// [{ group, count, dotCount, latestTime, showType, interactiveShowType }]
```

### 参数

无。

## 通知列表

`bot.notice.list(options?)` — 通知列表，缺省互动分组 401。

```ts
const page = await bot.notice.list({ count: 20, group: 401 })
// { list: [{ nid, type, createTime, raw }], hasMore, maxTime, minTime }
```

### 参数

| 参数 | 类型 | 说明 |
|------|------|------|
| count | number | 单页条数，缺省 20 |
| group | number | 通知分组，缺省 401 |
| maxTime | number | 上翻游标（旧通知），缺省 0 |
| minTime | number | 下翻游标（新通知），缺省 1 |
| markRead | boolean | 拉取即标记已读，缺省 true |

> 分页：用返回的 `maxTime`/`minTime` 作为下一次请求的同名游标。