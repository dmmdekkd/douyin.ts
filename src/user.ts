/** 自身资料:自动获取 uid 与昵称/头像,供登录收尾与 Bot 构造。 */
import { im } from './sign/const.js'
import type { Http } from './http/index.js'

export interface SelfInfo {
  uid?: string
  nickname?: string
  /** 真实头像(avatar_thumb.url_list 首个;passport 的 avatar_url 是 mosaic 占位) */
  avatar?: string
}

/** GET /aweme/v1/web/user/profile/self/ — 桌面 IM 自我资料(对齐 douyin-im getSelfProfile) */
export async function self (http: Http): Promise<SelfInfo> {
  const params = new URLSearchParams({
    aid: im.aid,
    version_name: im.version,
    version_code: im.version,
    device_platform: 'win32',
    screen_width: '1707',
    screen_height: '1067',
    browser_language: 'zh-CN',
    browser_platform: 'Win32',
    browser_name: 'Mozilla',
    browser_version: http.ua.replace(/^Mozilla\//, ''),
    browser_online: 'true',
    cookie_enabled: 'true',
    device_id: http.deviceId,
    did: http.deviceId,
    iid: http.installId,
    awemeim_guid: http.guid,
    channel: '0',
  })
  const res = await http.json<Record<string, unknown>>(`${im.origin}/aweme/v1/web/user/profile/self/?${params}`)
  const user = (res.data['user'] ?? {}) as Record<string, unknown>
  const nickname = typeof user['nickname'] === 'string' ? user['nickname'] : undefined
  const uid = user['uid'] ?? user['user_id_str'] ?? user['user_id']
  // 对齐 douyin-im mapProfile:真实头像在 avatar_thumb.url_list
  const thumb = user['avatar_thumb'] as { url_list?: unknown } | undefined
  const avatar = Array.isArray(thumb?.url_list)
    ? thumb.url_list.find((u): u is string => typeof u === 'string' && u !== '')
    : undefined
  return {
    ...(uid != null ? { uid: String(uid) } : {}),
    ...(nickname ? { nickname } : {}),
    ...(avatar ? { avatar } : {}),
  }
}
