import type { Http } from '../http/client.js'

/** 官方表情资源（/aweme/v1/web/emoji/list/ 下发，id 为拼音资源名，name 与表态键值同源） */
export interface EmojiInfo {
  /** 资源 id（如 weixiao / jinli） */
  id: string
  /** 显示键值（如 [微笑]） */
  name: string
  /** TOS 资源路径（tos-cn-i-tsj2vxp0zn/<hash>，hash 与官方面板小表情分区图片一致） */
  uri: string
  /** CDN 直链（带签名时效，过期后可用 uri 重新换链） */
  urls: string[]
}

/**
 * 官方小表情全量映射（214 项），即官方表情面板「小表情」分区数据源。
 * 键值以文本形式收发（如消息里的 [微笑]），不做图片消息；tos-cn 域资源发 lite_emoji 会被服务端注入 s:visible 仅发送者可见
 */
export async function getEmojiList (http: Http): Promise<EmojiInfo[]> {
  const res = await http.json<{ emoji_list?: Array<{
    origin_uri?: string
    display_name?: string
    hide?: number
    emoji_url?: { uri?: string; url_list?: string[] }
  }> }>('https://www.douyin.com/aweme/v1/web/emoji/list/', {
    headers: { Referer: 'https://www.douyin.com/' },
  })
  const list = res.data?.emoji_list
  if (!list?.length) throw new Error(`表情列表不可用 (HTTP ${res.status})`)
  return list.filter(e => !e.hide && e.display_name).map(e => ({
    id: (e.origin_uri ?? '').replace(/\.png$/, ''),
    name: e.display_name!,
    uri: e.emoji_url?.uri ?? '',
    urls: e.emoji_url?.url_list ?? [],
  }))
}

/** 小表情键值缓存：官方键值长期稳定，缓存只为省去每次发送都拉全量列表 */
const TEXT_TTL = 300_000
let emojiCache: { at: number; map: Map<string, string> } | undefined

/** 小表情 id（如 weixiao）→ 显示键值（[微笑]）；未收录返回 undefined。命中后按官方文本形态发送 */
export async function emojiTextOf (http: Http, id: string): Promise<string | undefined> {
  if (!emojiCache || Date.now() - emojiCache.at > TEXT_TTL) {
    const map = new Map((await getEmojiList(http)).map(e => [e.id, e.name]))
    emojiCache = { at: Date.now(), map }
  }
  return emojiCache.map.get(id)
}
