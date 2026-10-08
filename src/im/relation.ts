/** 关注/粉丝关系（/aweme/v1/web/user/following|follower/list/，www-hj EDGE 域 + web a_bogus 签名） */
import { aBogus } from '../sign/bogus.js'
import type { Http } from '../http/client.js'

const EDGE = 'https://www-hj.douyin.com'
/** 主站 webapp aid（抓包值，非 IM 桌面 aid） */
const AID = '6383'

export interface RelationUser {
  uid: string
  secUid?: string
  nickname: string
  avatar?: string
  signature?: string
  /** 我是否关注对方 */
  following: boolean
  /** 对方是否关注我（两者皆真即互关） */
  followed: boolean
  /** 对方粉丝数 */
  followerCount?: number
}

export interface RelationOptions {
  /** 目标用户 uid，缺省为登录账号 */
  uid?: string
  /** 目标用户 secUid（与 uid 同时提供，官方请求两者都带） */
  secUid?: string
  /** 起始偏移（翻页传上页返回的 offset） */
  offset?: number
  /** 粉丝列表时间游标（翻页传上页返回的 maxTime） */
  maxTime?: number
  /** 单页条数，官方默认 20 */
  count?: number
}

export interface RelationPage {
  users: RelationUser[]
  /** 列表总数（响应 total，可能为 0 但 has_more 为真） */
  total: number
  hasMore: boolean
  /** 下一页 offset（已按本页条数累加） */
  offset: number
  /** 粉丝列表下一页时间游标，请求时作 maxTime */
  maxTime?: number
}

export interface MutualOptions extends RelationOptions {
  /** 互关数量上限（自动翻页直到拉满或拉完），缺省不限 */
  limit?: number
}

interface RawUser extends Record<string, unknown> {
  uid?: string | number
  sec_uid?: string
  nickname?: string
  signature?: string
  follow_status?: number
  follower_status?: number
  follower_count?: number
  avatar_thumb?: { url_list?: unknown }
}

interface RawPage {
  status_code?: number
  total?: number
  has_more?: boolean
  offset?: number
  min_time?: number
  max_time?: number
  followings?: RawUser[]
  followers?: RawUser[]
}

/** 关注列表（我关注的人） */
export async function followUsers (http: Http, options: RelationOptions = {}): Promise<RelationPage> {
  return page(http, 'following', options)
}

/** 粉丝列表（关注我的人） */
export async function fanUsers (http: Http, options: RelationOptions = {}): Promise<RelationPage> {
  return page(http, 'follower', options)
}

/** 互关列表：翻关注列表过滤对方也关注我，拉满 limit（缺省全量）或无更多即止 */
export async function mutualUsers (http: Http, options: MutualOptions = {}): Promise<RelationUser[]> {
  const limit = options.limit ?? Number.POSITIVE_INFINITY
  const mutual: RelationUser[] = []
  let offset = options.offset ?? 0
  for (;;) {
    const res = await page(http, 'following', { ...options, offset })
    mutual.push(...res.users.filter(u => u.followed))
    if (mutual.length >= limit || !res.hasMore) {
      return mutual.length > limit ? mutual.slice(0, limit) : mutual
    }
    offset = res.offset
  }
}

async function page (http: Http, kind: 'following' | 'follower', options: RelationOptions): Promise<RelationPage> {
  const params = new URLSearchParams({
    device_platform: 'webapp',
    aid: AID,
    channel: 'channel_pc_web',
    ...(options.uid ? { user_id: options.uid } : {}),
    ...(options.secUid ? { sec_user_id: options.secUid } : {}),
    offset: String(options.offset ?? 0),
    min_time: '0',
    max_time: String(options.maxTime ?? 0),
    count: String(options.count ?? 20),
    source_type: '2',
  })
  const query = params.toString()
  const bogus = aBogus({ userAgent: http.ua, query })
  const res = await http.json<RawPage>(`${EDGE}/aweme/v1/web/user/${kind}/list/?${query}&a_bogus=${encodeURIComponent(bogus)}`)
  const data = res.data
  const code = Number(data.status_code ?? 0)
  if (code !== 0) throw new Error(`${kind}/list failed: code=${code}`)
  const users = (kind === 'following' ? data.followings : data.followers) ?? []
  // 粉丝列表翻页有时间游标（max_time=上页 min_time），关注列表纯 offset 累加
  const offset = Number(data.offset ?? (options.offset ?? 0) + users.length)
  return {
    users: users.map(userOf),
    total: Number(data.total ?? 0),
    hasMore: Boolean(data.has_more),
    offset,
    ...(kind === 'follower' && data.min_time != null ? { maxTime: Number(data.min_time) } : {}),
  }
}

function userOf (raw: RawUser): RelationUser {
  const thumb = Array.isArray(raw.avatar_thumb?.url_list)
    ? raw.avatar_thumb.url_list.find((u): u is string => typeof u === 'string' && u !== '')
    : undefined
  return {
    uid: String(raw.uid ?? ''),
    ...(raw.sec_uid ? { secUid: raw.sec_uid } : {}),
    nickname: String(raw.nickname ?? ''),
    ...(thumb ? { avatar: thumb } : {}),
    ...(raw.signature ? { signature: raw.signature } : {}),
    following: Number(raw.follow_status ?? 0) === 1,
    followed: Number(raw.follower_status ?? 0) === 1,
    ...(raw.follower_count != null ? { followerCount: Number(raw.follower_count) } : {}),
  }
}
