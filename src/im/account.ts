/** passport 账号:GET /passport/account/info/v2/,登录态下取当前账号详情(uid/昵称/手机/邮箱) */
import { passportBaseQuery, signQuery } from '../sign/qs.js'
import { passport } from '../sign/const.js'
import { sdkSourceInfo, signExtras } from '../login.js'
import type { Http } from '../http/client.js'

/** 当前 passport 账号详情(未建模字段走 raw 透传) */
export interface AccountInfo {
  userId: string
  secUserId: string
  name?: string
  screenName?: string
  avatar?: string
  mobile?: string
  email?: string
  gender?: number
  hasPassword?: boolean
  createTime?: number
  raw: Record<string, unknown>
}

/** account/info/v2:passport 签名链路(2.4.12 基础 query + sign + qs),无 body 的明文 GET */
export async function accountInfo (http: Http): Promise<AccountInfo> {
  const query = passportBaseQuery({
    deviceId: http.deviceId,
    installId: http.installId,
    accountSdkSourceInfo: sdkSourceInfo(http),
    bizTraceId: http.bizTraceId,
  })
  const { search } = signQuery(query, {}, signExtras(http))
  const url = `${passport.origin}/passport/account/info/v2/?${search}`
  const res = await http.json<{ data?: Record<string, unknown> }>(url, {
    headers: http.passportHeaders(url),
  })
  const raw = res.data?.data
  if (!raw) throw new Error(`account/info failed: HTTP ${res.status}`)
  return {
    userId: String(raw['user_id'] ?? raw['user_id_str'] ?? ''),
    secUserId: String(raw['sec_user_id'] ?? ''),
    ...(typeof raw['name'] === 'string' && raw['name'] ? { name: raw['name'] } : {}),
    ...(typeof raw['screen_name'] === 'string' && raw['screen_name'] ? { screenName: raw['screen_name'] } : {}),
    ...(typeof raw['avatar_url'] === 'string' && raw['avatar_url'] ? { avatar: raw['avatar_url'] } : {}),
    ...(typeof raw['mobile'] === 'string' ? { mobile: raw['mobile'] } : {}),
    ...(typeof raw['email'] === 'string' ? { email: raw['email'] } : {}),
    ...(raw['gender'] != null ? { gender: Number(raw['gender']) } : {}),
    ...(raw['has_password'] != null ? { hasPassword: Number(raw['has_password']) === 1 } : {}),
    ...(raw['user_create_time'] != null ? { createTime: Number(raw['user_create_time']) } : {}),
    raw,
  }
}

/**
 * token/beat/web:passport 令牌心跳,长期在线续杯防掉线。
 * scene boot=启动首跳、polling=周期轮询;version 为 beat 携带的 SDK 版本(HAR 实证 1.2.13)
 */
export async function beatToken (http: Http, scene = 'boot'): Promise<void> {
  const query = {
    ...passportBaseQuery({
      deviceId: http.deviceId,
      installId: http.installId,
      accountSdkSourceInfo: sdkSourceInfo(http),
      bizTraceId: http.bizTraceId,
      extra: { scene },
    }),
    version: '1.2.13',
  }
  const { search } = signQuery(query, {}, signExtras(http))
  const url = `${passport.origin}/passport/token/beat/web/?${search}`
  const res = await http.json<{ data?: { error_code?: number } }>(url, {
    headers: http.passportHeaders(url),
  })
  if (Number(res.data?.data?.error_code ?? -1) !== 0) throw new Error(`令牌心跳失败 (HTTP ${res.status})`)
}