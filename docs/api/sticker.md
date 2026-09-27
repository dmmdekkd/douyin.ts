# sticker 表情

表情贴纸资源：表情列表、我的收藏、动图（GIF）表情，以及收藏/取消收藏。走浏览器 cookie 直调，无需签名。

## 表情列表

`bot.sticker.list(options?)` — 表情资源列表，`scenes` 决定面板（缺省我的收藏）。

```ts
const page = await bot.sticker.list()
const panel = await bot.sticker.list({ scenes: 'CUSTOM_STICKER_PANEL' })
```

### 参数

| 参数 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| options.scenes | string | - | 面板场景，缺省我的收藏面板 |
| options.cursor | number | - | 翻页游标 |
| options.limit | number | - | 单页条数 |

## 我的收藏

`bot.sticker.favs()` — 我的收藏表情。等价于 `list()` 缺省入参，语义更明确。

```ts
const favs = await bot.sticker.favs()
```

## 动图表情

`bot.sticker.gifs()` — 动图/GIF 表情：收藏中带动图的贴纸。抖音 GIF 表情没有独立接口，即贴纸的动图形态（webp 载体），`gifs()` 在收藏基础上过滤出带 `animate` 动图的贴纸。

```ts
const gifs = await bot.sticker.gifs()
for (const g of gifs.list) {
  console.log(g.animate.urls[0]) // 动图直链（带签名时效）
}
```

## 收藏表情

`bot.sticker.collect(ids, options?)` — 收藏/取消收藏。

```ts
await bot.sticker.collect(['7383944950850781211'])
await bot.sticker.collect(['7383944950850781211'], { remove: true })
```

### 参数

| 参数 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| ids | string[] | - | 贴纸 id 列表 |
| options.remove | boolean | `true` `false` | true 取消收藏 |

## 热门表情

`bot.sticker.trending(options?)` — 热门表情分页。响应无总量，`done` 由 `has_more` 表达。

```ts
const page = await bot.sticker.trending({ cursor: 0, count: 50 })
while (!page.done) {
  const next = await bot.sticker.trending({ cursor: page.cursor, count: 50 })
  page.list.push(...next.list)
}
```

### 参数

| 参数 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| options.cursor | number | `0` | 翻页游标 |
| options.count | number | `50` | 单页条数 |

## 能力开关

`bot.sticker.strategy(scenes?)` — app 能力开关，返回决策树与动效资源包配置，`scenes` 决定拉取哪套（缺省 `interactive_resources`）。

```ts
const cfg = await bot.sticker.strategy()
// { decisionTrees?, interactiveResourceConfig? }
```

## 数据结构

资源列表为分页结构（`list` / `favs` / `gifs` / `trending` 均同形），需要全量时按 `done` + `cursor` 翻页。

```ts
interface Sticker {
  id: string        // 贴纸 id（字符串，服务端 number 字段在 JS 中会丢精度）
  type: number      // sticker_type：如 2=表情贴纸
  name?: string     // 显示名（如 [微笑]）
  hash?: string
  source?: string   // 来源标记（comment_emoji 等）
  static?: StickerImage      // 静态图
  animate?: StickerImage     // 动图（webp/gif 载体）
}

interface StickerImage {
  width: number
  height: number
  uri: string
  urls: string[]    // CDN 直链，带签名时效
}

interface StickerPage {
  list: Sticker[]
  total: number
  cursor: number
  done: boolean
}
```