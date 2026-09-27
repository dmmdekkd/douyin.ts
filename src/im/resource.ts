import type { Http } from '../http/client.js'

/** 贴纸图片（static 静态 / animate 动图，抖音 GIF 表情即动图贴纸） */
export interface StickerImage {
  width: number
  height: number
  uri: string
  urls: string[]
}

/** 表情贴纸（收藏/自定义/官方面板通用结构） */
export interface Sticker {
  /** 贴纸 id（用 id_str 字符串，服务端 number 字段在 JS 中会丢精度） */
  id: string
  /** sticker_type：如 2=表情贴纸 */
  type: number
  /** 显示名（如 [微笑]，空串不返回） */
  name?: string
  hash?: string
  /** 来源标记（comment_emoji 等） */
  source?: string
  /** 静态图 */
  static?: StickerImage
  /** 动图（webp/gif 载体） */
  animate?: StickerImage
}

/** 表情资源列表页（scenes 决定响应顶层键，统一收拢为此结构） */
export interface StickerPage {
  list: Sticker[]
  total: number
  cursor: number
  done: boolean
}

/** 收藏操作结果：成功收藏/取消的贴纸 id */
export interface StickerCollectResult {
  ids: string[]
}

/** 表情面板场景：我的收藏页（HAR 中唯一确认值；其他面板场景可自行传参探测） */
export const SCENES_FAVS = 'CUSTOM_STICKER_PAGE'

const ORIGIN = 'https://www.douyin.com'

/** 表情资源列表：/aweme/v1/web/im/resource/list/aggregation/，scenes 决定返回哪套贴纸（缺省我的收藏） */
export async function stickerList (
  http: Http,
  options: { scenes?: string; cursor?: number; limit?: number } = {},
): Promise<StickerPage> {
  const scenes = options.scenes ?? SCENES_FAVS
  const params = new URLSearchParams({
    device_platform: 'webapp',
    aid: '1128',
    app_id: '1128',
    channel: 'channel_pc_web',
    scenes,
    source: scenes,
    custom_cursor: String(options.cursor ?? 0),
    custom_limit: String(options.limit ?? 50),
  })
  const res = await http.json<Record<string, unknown>>(
    `${ORIGIN}/aweme/v1/web/im/resource/list/aggregation/?${params}`,
    { headers: { Referer: ORIGIN } },
  )
  if (Number(res.data.status_code ?? -1) !== 0) throw new Error(`表情列表不可用 (HTTP ${res.status})`)
  const bean = Object.values(res.data).find(isPageBean)
  if (!bean || !bean.resources) return { list: [], total: 0, cursor: 0, done: true }
  // 每个 resource 含 stickers 数组（官方 pc web 上 resource/sticker 两级）
  const stickers: Array<Record<string, unknown>> = []
  for (const r of bean.resources) {
    const rec = r as Record<string, unknown>
    if (Array.isArray(rec['stickers'])) stickers.push(...(rec['stickers'] as Array<Record<string, unknown>>))
  }
  return {
    list: stickers.map(stickerOf),
    total: Number(bean.total_counts ?? 0),
    cursor: Number(bean.next_cursor ?? 0),
    done: bean.is_completed === true,
  }
}

/** 收藏/取消收藏表情：/aweme/v1/web/im/resource/sticker/collect/，参数全部走 query，body 为固定 {} */
export async function stickerCollect (
  http: Http,
  ids: string[],
  options: { remove?: boolean; uri?: string; url?: string } = {},
): Promise<StickerCollectResult> {
  const params = new URLSearchParams({
    action: options.remove ? '1' : '0',
    sticker_ids: `[${ids.join(',')}]`,
    sticker_uri: options.uri ?? '',
    sticker_url: options.url ?? '',
    resource_id: '0',
    sticker_type: '0',
  })
  const res = await http.json<{ success_items?: Array<{ id_str?: string; id?: number }>; status_code?: number }>(
    `${ORIGIN}/aweme/v1/web/im/resource/sticker/collect/?${params}`,
    { method: 'POST', headers: { Referer: ORIGIN, 'Content-Type': 'application/json' }, body: '{}' },
  )
  if (Number(res.data.status_code ?? -1) !== 0) throw new Error(`收藏表情失败 (HTTP ${res.status})`)
  return { ids: (res.data.success_items ?? []).map(s => s.id_str ?? String(s.id ?? '')) }
}

/** emoticon/trending:热门表情分页（cursor+count 翻页，groupId 固定 1） */
export async function emojiTrending (
  http: Http,
  options: { cursor?: number; count?: number } = {},
): Promise<StickerPage> {
  const params = new URLSearchParams({
    cursor: String(options.cursor ?? 0),
    count: String(options.count ?? 50),
    groupId: '1',
  })
  const res = await http.json<{
    emoticon_data?: { has_more?: boolean; next_cursor?: number; stickers?: unknown[] }
  }>(
    `${ORIGIN}/aweme/v1/web/im/resources/emoticon/trending?${params}`,
    { headers: { Referer: ORIGIN } },
  )
  const data = res.data?.emoticon_data
  return {
    list: (data?.stickers ?? []).map(raw => stickerOf(raw as Record<string, unknown>)),
    total: 0, // 热门页无总量，done 用 has_more 表达
    cursor: Number(data?.next_cursor ?? 0),
    done: data?.has_more !== true,
  }
}

/** strategy/config:app 能力开关结果（决策树 + 动效资源包配置） */
export interface StrategyConfig {
  decisionTrees?: Record<string, unknown>
  interactiveResourceConfig?: Record<string, unknown>
}

/** strategy/config:app 能力开关（决策树 + 动效资源包配置） */
export async function strategyConfig (
  http: Http,
  scenes: string[] = ['interactive_resources'],
): Promise<StrategyConfig> {
  const params = new URLSearchParams({ app_id: '1128', scenes: JSON.stringify(scenes) })
  const res = await http.json<{
    decision_trees?: Record<string, unknown>
    interactive_resource_config?: Record<string, unknown>
  }>(
    `${ORIGIN}/aweme/v1/web/im/strategy/config?${params}`,
    { headers: { Referer: ORIGIN } },
  )
  return {
    ...(res.data?.decision_trees ? { decisionTrees: res.data.decision_trees } : {}),
    ...(res.data?.interactive_resource_config ? { interactiveResourceConfig: res.data.interactive_resource_config } : {}),
  }
}

function isPageBean (v: unknown): v is { resources?: unknown[]; total_counts?: unknown; next_cursor?: unknown; is_completed?: unknown } {
  return !!v && typeof v === 'object' && Array.isArray((v as { resources?: unknown }).resources)
}

function stickerOf (raw: Record<string, unknown>): Sticker {
  return {
    id: typeof raw['id_str'] === 'string' ? raw['id_str'] : String(raw['id'] ?? ''),
    type: Number(raw['sticker_type'] ?? 0),
    ...(typeof raw['display_name'] === 'string' && raw['display_name'] ? { name: raw['display_name'] } : {}),
    ...(typeof raw['hash'] === 'string' ? { hash: raw['hash'] } : {}),
    ...(typeof raw['sticker_info_source'] === 'string' ? { source: raw['sticker_info_source'] } : {}),
    ...(isImage(raw['static_url']) ? { static: imageOf(raw['static_url']) } : {}),
    ...(isImage(raw['animate_url']) ? { animate: imageOf(raw['animate_url']) } : {}),
  }
}

function isImage (v: unknown): v is { url_list?: unknown } {
  return !!v && typeof v === 'object' && Array.isArray((v as { url_list?: unknown }).url_list)
}

function imageOf (v: { url_list?: unknown }): StickerImage {
  return {
    width: Number((v as { width?: unknown }).width ?? 0),
    height: Number((v as { height?: unknown }).height ?? 0),
    uri: String((v as { uri?: unknown }).uri ?? ''),
    urls: (v.url_list as unknown[] | undefined)?.filter((u): u is string => typeof u === 'string') ?? [],
  }
}