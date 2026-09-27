import { fingerprintParams } from './transport.js'
import type { Http } from '../http/client.js'

/** 用户公开资料（昵称/头像） */
export interface UserProfile {
  nickname?: string
  avatar?: string
}

/** desktop IM user/info：按 secUid 批量拉资料（群昵称不随 605 下发，只能在此查），50 一批 */
export async function getUserProfiles (http: Http, secUids: string[]): Promise<Map<string, UserProfile>> {
  const result = new Map<string, UserProfile>()
  const list = [...new Set(secUids.filter(Boolean))]
  for (let offset = 0; offset < list.length; offset += 50) {
    const batch = list.slice(offset, offset + 50)
    const params = fingerprintParams(http.deviceId, http.guid)
    params.set('iid', http.installId)
    const form = new FormData()
    form.append('sec_user_ids', JSON.stringify(batch))
    try {
      const res = await http.json<{ status_code?: number; data?: unknown }>(
        `https://imdesktop.douyin.com/aweme/v1/web/im/user/info/?${params}`,
        { method: 'POST', body: form, headers: { Referer: 'https://imdesktop.douyin.com' } },
      )
      if (Number(res.data?.status_code ?? -1) !== 0 || !Array.isArray(res.data?.data)) continue
      for (const raw of res.data.data as Record<string, unknown>[]) {
        const secUid = typeof raw['sec_uid'] === 'string' ? raw['sec_uid'] : ''
        if (!secUid) continue
        const nickname = typeof raw['nickname'] === 'string' ? raw['nickname'] : ''
        const thumb = raw['avatar_thumb'] as { url_list?: unknown } | undefined
        const avatar = Array.isArray(thumb?.url_list)
          ? thumb.url_list.find((u): u is string => typeof u === 'string' && u !== '')
          : undefined
        if (!nickname && !avatar) continue
        result.set(secUid, { ...(nickname ? { nickname } : {}), ...(avatar ? { avatar } : {}) })
      }
    } catch { /* 单批失败不缓存，避免污染其他 ID */ }
  }
  return result
}

/** 用户详细资料（profileScene/profileOther 共用；未建模字段走 raw 透传） */
export interface ProfileDetail {
  uid: string
  secUid: string
  nickname?: string
  signature?: string
  avatar?: string
  uniqueId?: string
  followingCount?: number
  followerCount?: number
  followStatus?: number
  followerStatus?: number
  raw: Record<string, unknown>
}

const PROFILE_ORIGIN = 'https://www-hj.douyin.com'

/** profile/scene:对话场景资料（响应顶层即用户对象，字段比 profile/other 少） */
export async function profileScene (http: Http, secUid: string): Promise<ProfileDetail> {
  const params = fingerprintParams(http.deviceId, http.guid)
  params.set('iid', http.installId)
  params.set('sec_user_id', secUid)
  params.set('wish_flag', '1')
  params.set('scene', '5')
  params.set('source', '4')
  const res = await http.json<Record<string, unknown>>(
    `${PROFILE_ORIGIN}/aweme/v1/web/user/profile/scene/?${params}`,
    { headers: { Referer: 'https://www.douyin.com/' } },
  )
  return profileOf(res.data)
}

/** profile/other:完整资料（user 字段打包，含地域/年龄等原始字段） */
export async function profileOther (http: Http, secUid: string): Promise<ProfileDetail> {
  const params = fingerprintParams(http.deviceId, http.guid)
  params.set('iid', http.installId)
  params.set('source', 'channel_pc_web')
  params.set('sec_user_id', secUid)
  params.set('personal_center_strategy', '1')
  params.set('profile_other_record_enable', '1')
  params.set('land_to', '1')
  const res = await http.json<{ user?: Record<string, unknown> }>(
    `${PROFILE_ORIGIN}/aweme/v1/web/user/profile/other/?${params}`,
    { headers: { Referer: 'https://www.douyin.com/' } },
  )
  if (!res.data?.user) throw new Error(`用户资料不可用 (HTTP ${res.status})`)
  return profileOf(res.data.user)
}

function profileOf (raw: Record<string, unknown>): ProfileDetail {
  const avatar = avatarOf(raw['avatar_thumb'])
  return {
    uid: String(raw['uid'] ?? ''),
    secUid: String(raw['sec_uid'] ?? ''),
    ...(typeof raw['nickname'] === 'string' && raw['nickname'] ? { nickname: raw['nickname'] } : {}),
    ...(typeof raw['signature'] === 'string' && raw['signature'] ? { signature: raw['signature'] } : {}),
    ...(avatar ? { avatar } : {}),
    ...(typeof raw['unique_id'] === 'string' && raw['unique_id'] ? { uniqueId: raw['unique_id'] } : {}),
    ...(raw['following_count'] != null ? { followingCount: Number(raw['following_count']) } : {}),
    ...(raw['follower_count'] != null ? { followerCount: Number(raw['follower_count']) } : {}),
    ...(raw['follow_status'] != null ? { followStatus: Number(raw['follow_status']) } : {}),
    ...(raw['follower_status'] != null ? { followerStatus: Number(raw['follower_status']) } : {}),
    raw,
  }
}

function avatarOf (v: unknown): string | undefined {
  const list = (v as { url_list?: unknown } | undefined)?.url_list
  if (!Array.isArray(list)) return undefined
  return list.find((u): u is string => typeof u === 'string' && u !== '')
}
