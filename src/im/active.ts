import type { Http } from '../http/client.js'

const ORIGIN = 'https://www.douyin.com'
const EDGE = 'https://www-hj.douyin.com'

/** 在线状态项（secUserId 维度） */
export interface OnlineItem {
  secUserId: string
  /** 最后活跃时间（秒时间戳），0 表示从未在线 */
  lastActiveTime: number
}

/** active/update:im 活跃心跳上报（登录后打一次即可，成功即静默） */
export async function heartbeat (http: Http): Promise<void> {
  const res = await http.json<{ status_code?: number }>(
    `${EDGE}/aweme/v1/web/im/user/active/update/?action=heartbeat&new_user_login=0`,
    { headers: { Referer: ORIGIN } },
  )
  if (Number(res.data?.status_code ?? -1) !== 0) throw new Error(`心跳上报失败 (HTTP ${res.status})`)
}

/** active/status:批量查 sec 用户在线状态（source 透传，缺省 heartbeat） */
export async function onlineStatus (
  http: Http,
  secUserIds: string[],
  source = 'heartbeat',
): Promise<OnlineItem[]> {
  const form = new URLSearchParams({
    conv_ids: '[]',
    sec_user_ids: JSON.stringify(secUserIds),
    source,
  })
  const res = await http.json<{
    data?: Array<{ sec_user_id?: string; last_active_time?: number }>
  }>(
    `${ORIGIN}/aweme/v1/web/im/user/active/status/`,
    {
      method: 'POST',
      headers: { Referer: ORIGIN, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    },
  )
  return (res.data?.data ?? []).map(item => ({
    secUserId: String(item.sec_user_id ?? ''),
    lastActiveTime: Number(item.last_active_time ?? 0),
  }))
}

/** active/config/get:查询在线状态开关（1=开启，我可被对方看到在线） */
export async function activeSwitch (http: Http): Promise<number> {
  const res = await http.json<{ status_switch?: number }>(
    `${ORIGIN}/aweme/v1/web/im/user/active/config/get`,
    { headers: { Referer: ORIGIN } },
  )
  return Number(res.data?.status_switch ?? 0)
}

/** 已读回执项（conv_short_id 透传原样，避免 int64 在 JSON 里丢精度） */
export interface ReadSwitchItem {
  msgId: string
  convId: string
  convShortId: string | number
  createTime: number
  convType: number
}

/** msg_read_switch:标记一批消息已读（会话侧收件箱收到 50013 的依据；source 固定 msg_tab） */
export async function readSwitch (http: Http, items: ReadSwitchItem[]): Promise<void> {
  const res = await http.json<{
    msg_ids_resp?: Array<{ msg_id?: string; err_code?: number }>
  }>(
    `${ORIGIN}/aweme/v1/web/im_communication/msg_read_switch/`,
    {
      method: 'POST',
      headers: { Referer: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msg_ids: items.map(it => ({
          msg_id: it.msgId,
          conv_id: it.convId,
          conv_short_id: it.convShortId,
          create_time: it.createTime,
          conv_type: it.convType,
        })),
        is_retry: false,
        source: 'msg_tab',
      }),
    },
  )
  const failed = (res.data?.msg_ids_resp ?? []).find(r => Number(r.err_code ?? 0) !== 0)
  if (failed) throw new Error(`已读回执失败 msg_id=${failed.msg_id ?? ''} (HTTP ${res.status})`)
}