import { fingerprintParams } from './transport.js'
import type { Http } from '../http/client.js'

const WEB_ORIGIN = 'https://www.douyin.com'
const IM_ORIGIN = 'https://imdesktop.douyin.com'

/** 社交用户摘要（spotlight/relation 与 familiar/list 共用；未建模字段走 raw 透传） */
export interface SocialUser {
  uid: string
  secUid: string
  nickname: string
  avatar?: string
  signature?: string
  uniqueId?: string
  followStatus: number
  followerStatus: number
  raw: Record<string, unknown>
}

/** 气泡详情（bubble/detail_list 单条；resource 结构繁复，只提取预览图） */
export interface Bubble {
  id: string
  name: string
  type: number
  source: number
  description?: string
  /** 亮色预览图 */
  lightPreview?: string
  /** 暗色预览图 */
  darkPreview?: string
  /** 是否为用户当前使用中的气泡 */
  current: boolean
  raw: Record<string, unknown>
}

/** 好友/关注列表分页（spotlight 返回 top 侧分页字段） */
export interface RelationPage {
  users: SocialUser[]
  hasMore: boolean
  maxTime: number
  minTime: number
}

/** bubble/detail_list：按 bubble_id 查气泡详情（need_user_current_bubble 附带当前使用标记） */
export async function bubbleDetail (
  http: Http,
  bubbleId: string,
  options: { needCurrent?: boolean } = {},
): Promise<Bubble[]> {
  const params = fingerprintParams(http.deviceId, http.guid)
  params.set('iid', http.installId)
  params.set('bubble_id', bubbleId)
  params.set('need_user_current_bubble', String(options.needCurrent ?? true))
  const res = await http.json<{ status_code?: number; bubble_list?: unknown[] }>(
    `${WEB_ORIGIN}/aweme/v1/web/im/bubble/detail_list/?${params}`,
    { headers: { Referer: WEB_ORIGIN } },
  )
  if (Number(res.data?.status_code ?? -1) !== 0) throw new Error(`气泡详情不可用 (HTTP ${res.status})`)
  return (res.data?.bubble_list ?? []).map(bubbleOf)
}

/** spotlight/relation：关注/好友关系列表（默认 100 条，含推荐与真实网络标记） */
export async function spotlight (
  http: Http,
  options: { count?: number; source?: string } = {},
): Promise<RelationPage> {
  const params = fingerprintParams(http.deviceId, http.guid)
  params.set('iid', http.installId)
  params.set('count', String(options.count ?? 100))
  params.set('source', options.source ?? 'coldup_full')
  params.set('with_fstatus', '1')
  params.set('max_time', '0')
  params.set('min_time', '0')
  params.set('address_book_access', '1')
  params.set('new_user_login', '0')
  params.set('need_sorted_info', 'true')
  params.set('need_network_recommend', 'true')
  params.set('need_real_network', 'true')
  params.set('need_remove_share_panel', 'true')
  const res = await http.json<{
    status_code?: number
    followings?: unknown[]
    has_more?: boolean
    max_time?: number
    min_time?: number
  }>(
    `${WEB_ORIGIN}/aweme/v1/web/im/spotlight/relation?${params}`,
    { headers: { Referer: WEB_ORIGIN } },
  )
  return {
    users: (res.data?.followings ?? []).map(socialOf),
    hasMore: res.data?.has_more === true,
    maxTime: Number(res.data?.max_time ?? 0),
    minTime: Number(res.data?.min_time ?? 0),
  }
}

/**
 * commit/follow/user：关注用户（type=0 关注；响应体为空，只能以 HTTP 状态判定）。
 * verifyFp 与设备绑定：verify_<deviceId>，缺设备时不下发
 */
export async function followUser (
  http: Http,
  userId: string,
  secUid: string,
  options: { type?: number; tag?: string } = {},
): Promise<void> {
  const params = fingerprintParams(http.deviceId, http.guid)
  params.set('iid', http.installId)
  params.set('user_id', userId)
  params.set('secUid', secUid)
  params.set('type', String(options.type ?? 0))
  params.set('tag', options.tag ?? 'frienddetail')
  if (http.hasDevice()) params.set('verifyFp', `verify_${http.deviceId}`)
  const res = await http.request(
    `${IM_ORIGIN}/aweme/v1/web/commit/follow/user/?${params}`,
    { method: 'POST', headers: { Referer: IM_ORIGIN } },
  )
  if (!res.ok) throw new Error(`关注失败 (HTTP ${res.status})`)
}

/** familiar/list：可能认识的人（version_code 特例 21.6.0，与常规 1.1.34 不同） */
export async function familiarList (
  http: Http,
  options: { count?: number; cursor?: number; recommendType?: number } = {},
): Promise<SocialUser[]> {
  const params = fingerprintParams(http.deviceId, http.guid)
  params.set('version_code', '21.6.0')
  params.set('iid', http.installId)
  params.set('cursor', String(options.cursor ?? 0))
  params.set('vcd_count', '0')
  params.set('hotsoon_has_more', '0')
  params.set('only_total', '0')
  params.set('count', String(options.count ?? 100))
  params.set('order_by', '1')
  params.set('need_all_friend', '1')
  params.set('recommend_type', String(options.recommendType ?? 22))
  const res = await http.json<{ status_code?: number; user_list?: unknown[] }>(
    `${IM_ORIGIN}/aweme/v1/web/familiar/list/?${params}`,
    { headers: { Referer: IM_ORIGIN } },
  )
  if (Number(res.data?.status_code ?? -1) !== 0) throw new Error(`熟人列表不可用 (HTTP ${res.status})`)
  return (res.data?.user_list ?? []).map(socialOf)
}

function bubbleOf (raw: unknown): Bubble {
  const r = raw as Record<string, unknown>
  const resource = r['resource'] as Record<string, unknown> | undefined
  const light = urlsOf(resource?.['top_preview_light_url'])?.[0]
  const dark = urlsOf(resource?.['top_preview_dark_url'])?.[0]
  return {
    id: typeof r['bubble_id_str'] === 'string' ? r['bubble_id_str'] : String(r['bubble_id'] ?? ''),
    name: typeof r['bubble_name'] === 'string' ? r['bubble_name'] : '',
    type: Number(r['bubble_type'] ?? 0),
    source: Number(r['source'] ?? 0),
    ...(typeof r['description'] === 'string' && r['description'] ? { description: r['description'] } : {}),
    ...(light ? { lightPreview: light } : {}),
    ...(dark ? { darkPreview: dark } : {}),
    current: r['is_user_current_set'] === true,
    raw: r,
  }
}

function socialOf (raw: unknown): SocialUser {
  const r = raw as Record<string, unknown>
  const avatar = urlsOf(r['avatar_thumb'])?.[0] ?? urlsOf(r['avatar_small'])?.[0]
  return {
    uid: String(r['uid'] ?? ''),
    secUid: String(r['sec_uid'] ?? ''),
    nickname: typeof r['nickname'] === 'string' ? r['nickname'] : '',
    ...(avatar ? { avatar } : {}),
    ...(typeof r['signature'] === 'string' && r['signature'] ? { signature: r['signature'] } : {}),
    ...(typeof r['unique_id'] === 'string' && r['unique_id'] ? { uniqueId: r['unique_id'] } : {}),
    followStatus: Number(r['follow_status'] ?? 0),
    followerStatus: Number(r['follower_status'] ?? 0),
    raw: r,
  }
}

function urlsOf (v: unknown): string[] | undefined {
  const list = (v as { url_list?: unknown } | undefined)?.url_list
  if (!Array.isArray(list)) return undefined
  return list.filter((u): u is string => typeof u === 'string' && u !== '')
}
