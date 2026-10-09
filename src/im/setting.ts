import { fingerprintParams } from './transport.js'
import type { Http } from '../http/client.js'

const IM_ORIGIN = 'https://imdesktop.douyin.com'
const WEB_ORIGIN = 'https://www.douyin.com'

/** 桌面 IM 消息设置（im/desktop/setting/get） */
export interface DesktopSetting {
  /** 消息提醒开关 */
  messageAlert: number
  /** 显示消息详情开关（服务端字段拼写即 swtich） */
  showMessageDetail: number
}

/** 账号综合设置（user/settings，字段庞大，未建模字段走 raw 透传） */
export interface UserSettings {
  /** 私密账号等级 */
  chatSet: number
  teenMode: number
  isMinor: boolean
  settingsVersion?: string
  raw: Record<string, unknown>
}

/** 合规/青少年模式设置（compliance/settings） */
export interface ComplianceSetting {
  minorControlType: number
  isMinor: boolean
  teenMode: number
  raw: Record<string, unknown>
}

/** im/desktop/setting/get：桌面消息提醒设置（无端点参数） */
export async function desktopSetting (http: Http): Promise<DesktopSetting> {
  const params = fingerprintParams(http.deviceId, http.guid)
  params.set('iid', http.installId)
  const res = await http.json<{
    base_resp?: { status_code?: number }
    message_alert_switch?: number
    show_message_detail_swtich?: number
  }>(
    `${IM_ORIGIN}/aweme/v1/im/desktop/setting/get?${params}`,
    { headers: { Referer: IM_ORIGIN } },
  )
  if (Number(res.data?.base_resp?.status_code ?? -1) !== 0) throw new Error(`桌面设置不可用 (HTTP ${res.status})`)
  return {
    messageAlert: Number(res.data.message_alert_switch ?? 0),
    showMessageDetail: Number(res.data.show_message_detail_swtich ?? 0),
  }
}

/** user/settings：账号综合设置（频率控制 + 本地缓存标记随请求下发） */
export async function userSettings (http: Http): Promise<UserSettings> {
  const params = fingerprintParams(http.deviceId, http.guid)
  params.set('iid', http.installId)
  params.set('is_fetch_frequency_control', 'true')
  params.set('has_local_cache', 'false')
  params.set('request_source', 'settings_page')
  const res = await http.json<Record<string, unknown>>(
    `${WEB_ORIGIN}/aweme/v1/web/user/settings/?${params}`,
    { headers: { Referer: WEB_ORIGIN } },
  )
  if (Number(res.data?.status_code ?? -1) !== 0) throw new Error(`账号设置不可用 (HTTP ${res.status})`)
  return {
    chatSet: Number(res.data['chat_set'] ?? 0),
    teenMode: Number(res.data['teen_mode'] ?? 0),
    isMinor: res.data['is_minor'] === true,
    ...(typeof res.data['settings_version'] === 'string' && res.data['settings_version']
      ? { settingsVersion: res.data['settings_version'] }
      : {}),
    raw: res.data,
  }
}

/** compliance/settings：合规/青少年模式设置（called_token 固定 impc_on_login） */
export async function complianceSetting (http: Http): Promise<ComplianceSetting> {
  const params = fingerprintParams(http.deviceId, http.guid)
  params.set('iid', http.installId)
  params.set('called_token', 'impc_on_login')
  params.set('called_token_extra_info_flag', String(Date.now()))
  params.set('teen_mode_status', '0')
  params.set('ftc_child_mode', '0')
  const res = await http.json<Record<string, unknown>>(
    `${IM_ORIGIN}/aweme/v1/web/compliance/settings/?${params}`,
    { headers: { Referer: IM_ORIGIN } },
  )
  if (Number(res.data?.status_code ?? -1) !== 0) throw new Error(`合规设置不可用 (HTTP ${res.status})`)
  return {
    minorControlType: Number(res.data['minor_control_type'] ?? 0),
    isMinor: res.data['is_minor'] === true,
    teenMode: Number(res.data['teen_mode'] ?? 0),
    raw: res.data,
  }
}
