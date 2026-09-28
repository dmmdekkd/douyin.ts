import { fingerprintParams } from './transport.js'
import type { Http } from '../http/client.js'

// www.douyin.com 域同接口被风控拦截（HTTP 200 返回非 JSON），imdesktop 域可用
const ORIGIN = 'https://imdesktop.douyin.com'

/** 群分享入参：邀请链接（自动解析 secret/group_id）或纯 secret + conversationId */
export interface GroupShareInput {
  /** 邀请链接或链接中的 secret（AAED 前缀） */
  share: string
  /** 群 conversationId；链接自带 group_id 时可省略 */
  conversationId?: string
  /** 邀请卡场景（invite_card_scene），缺省 0 */
  scene?: number
}

/** 群分享校验结果：发群邀请卡所需的 ticket 与群资料 */
export interface GroupShareResult {
  ticket: string
  conversationId: string
  conversationShortId: string
  name: string
  desc: string
  avatar?: string
  memberCount: number
  ownerUid?: string
  ownerSecUid?: string
  ownerNickname?: string
  inviterUid?: string
  inviterSecUid?: string
  auditQuestion?: string
}

interface ShareResponse {
  status_code?: number
  status_message?: string
  data?: Record<string, unknown>
}

function str (source: Record<string, unknown> | undefined, key: string): string {
  return typeof source?.[key] === 'string' ? String(source[key]) : ''
}

/** 解析邀请链接的 secret 与 group_id；纯 secret 直接使用 */
function parseShare (input: GroupShareInput): { secret: string; groupId: string } {
  const raw = input.share.trim()
  let secret = raw
  let groupId = input.conversationId ?? ''
  if (/^https?:\/\//.test(raw)) {
    const params = new URL(raw).searchParams
    // 分享链接里 secret/group_token、group_id/conversation_id 两种命名并存
    secret = params.get('secret') ?? params.get('group_token') ?? secret
    groupId = input.conversationId ?? params.get('group_id') ?? params.get('conversation_id') ?? ''
  }
  if (!secret || !groupId) throw new Error('群分享缺少 secret 或 conversationId')
  return { secret, groupId }
}

/**
 * 用群邀请 secret 换群邀请凭证：/aweme/v1/web/im_group_api/share/verification/。
 * 实证该接口回读群资料，且返回的 ticket 即传入的 secret（同值 AAED 串），
 * 与 610 会话详情下发的 ticket 是两条不同的串
 */
export async function verifyShare (http: Http, input: GroupShareInput): Promise<GroupShareResult> {
  const { secret, groupId } = parseShare(input)
  const params = fingerprintParams(http.deviceId, http.guid)
  params.set('iid', http.installId)
  const body = new URLSearchParams({
    ext: JSON.stringify({ group_reserve_v2_ab: '2', join_source: '5' }),
    group_id: groupId,
    invite_card_scene: String(input.scene ?? 0),
    secret,
    secret_type: '4',
  }).toString()
  const res = await http.request(`${ORIGIN}/aweme/v1/web/im_group_api/share/verification/?${params}`, {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: `${ORIGIN}/chat` },
  })
  // 16+ 位整数包成字符串再 parse：conversation_short_id/owner_id 等 19 位大整数超出 Number 精度
  const raw = JSON.parse(res.data.replace(/"(\w+)"\s*:\s*(\d{16,})/g, '"$1":"$2"')) as ShareResponse
  // 该域把校验体直接铺在 data 上（status_code 为群审核态，如 7535 仍带完整数据）
  const detail = raw.data
  if (!res.ok || !detail || str(detail, 'ticket') === '') {
    throw new Error(`群分享校验失败 (HTTP ${res.status}, status=${raw.status_code ?? '-'}, message=${raw.status_message ?? '-'})`)
  }
  const owner = detail['group_owner_info'] as Record<string, unknown> | undefined
  return {
    ticket: str(detail, 'ticket'),
    conversationId: str(detail, 'conversation_id') || groupId,
    conversationShortId: str(detail, 'conversation_short_id'),
    name: str(detail, 'group_name'),
    desc: str(detail, 'group_desc'),
    ...(str(detail, 'group_avatar') ? { avatar: str(detail, 'group_avatar') } : {}),
    memberCount: Number(detail['group_member_count'] ?? 0),
    ...(str(owner, 'owner_id') ? { ownerUid: str(owner, 'owner_id') } : {}),
    ...(str(owner, 'sec_owner_id') ? { ownerSecUid: str(owner, 'sec_owner_id') } : {}),
    ...(str(owner, 'owner_name') ? { ownerNickname: str(owner, 'owner_name') } : {}),
    ...(str(detail, 'inviter_id') ? { inviterUid: str(detail, 'inviter_id') } : {}),
    ...(str(detail, 'inviter_sec_uid') ? { inviterSecUid: str(detail, 'inviter_sec_uid') } : {}),
    ...(str(detail, 'group_audit_question') ? { auditQuestion: str(detail, 'group_audit_question') } : {}),
  }
}
