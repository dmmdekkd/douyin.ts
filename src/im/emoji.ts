import type { Http } from '../http/client.js'

/** 官方表情资源（/aweme/v1/web/emoji/list/ 下发，id 为拼音资源名，name 与表态键值同源） */
export interface EmojiInfo {
  /** 资源 id（如 weixiao / jinli） */
  id: string
  /** 显示键值（如 [微笑]） */
  name: string
  /** TOS 资源路径 */
  uri: string
  /** CDN 直链（带签名时效，过期后可用 uri 重新换链） */
  urls: string[]
}

/** 官方表情资源全量映射（214 项），用于发送表情消息（aweType 507）与表态键值展示 */
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
