import protobuf from 'protobufjs'
import { fingerprintParams } from './transport.js'
import type { ProtoTransport } from './transport.js'
import type { Http } from '../http/client.js'
import type {
  ActionResult,
  ChatMessage,
  ConversationAddress,
  FriendInfo,
  FriendRequestInfo,
  GroupInfo,
  GroupJoinRequestInfo,
  GroupMemberInfo,
  MarkReadItem,
  ModifyReactionItem,
  PrivateThread,
  RecallItem,
  RecallResult,
  StrangerInfo,
  ThreadPeer,
} from './types.js'
import { FriendRequestStatus, GroupJoinRequestStatus } from './types.js'

const LONG = protobuf.util.Long as unknown as { fromString (value: string): unknown }

export interface InboxContext {
  transport: ProtoTransport
  /** HTTP 链路（familiar/list 等 imdesktop 业务接口） */
  http: Http
  /** Desktop IM 设备 ID（Cookie 通道 query 用） */
  deviceId: string
  /** 平台数字 uid（thread 映射用） */
  platformUid: string
}

export interface InboxListOptions {
  cursor?: number
  count?: number
}

/* ---------------------------------------------------------------------------
 * proto 响应映射（原 mappers.ts，仅收件箱内部使用）
 * ------------------------------------------------------------------------- */

function isGroupConversationId (conversationId: string): boolean {
  return /^\d+$/.test(conversationId.trim())
}

export function mapProtoConversationListItem (raw: Record<string, unknown>): GroupInfo {
  const conversationId = String(raw['conversationId'] ?? '')
  const conversationType = Number(raw['conversationType'] ?? 0)
  // 群头像在 conversationCoreInfo.icon（对齐 douyin-im）；extInfo 仅补 name 等
  const core = raw['conversationCoreInfo'] as Record<string, unknown> | undefined
  const ext = raw['extInfo'] as Record<string, unknown> | undefined
  const setting = (raw['userSetting'] ?? raw['conversationSettingInfo']) as
    | Record<string, unknown>
    | undefined
  const memberBox = (raw['members'] ?? raw['firstPageParticipants']) as
    | { members?: Array<Record<string, unknown>>; participants?: Array<Record<string, unknown>> }
    | undefined
  const avatar = String(core?.['icon'] ?? ext?.['icon'] ?? core?.['avatar'] ?? ext?.['avatar'] ?? '')
  const ownerUid = String(ext?.['ownerUid'] ?? ext?.['owner'] ?? core?.['owner'] ?? '')
  // 群号落在 ConversationCoreInfo.ext 的 a:s_group_number（HAR 实证），会话列表 extInfo 同键兜底
  const coreExt = core?.['ext'] as Record<string, unknown> | undefined
  const groupNumber = String(coreExt?.['a:s_group_number'] ?? ext?.['a:s_group_number'] ?? '')
  // participants 键为 userId（对齐 douyin-im member['uid'] ?? member['userId']）
  const members = (memberBox?.members ?? memberBox?.participants ?? []).map((member) => {
    const secUid = String(member['secUid'] ?? '')
    return {
      uid: String(member['uid'] ?? member['userId'] ?? ''),
      role: Number(member['role'] ?? 0),
      ...(secUid ? { secUid } : {}),
    }
  }).filter((member) => member.uid && member.uid !== '0')
  return {
    conversationId,
    conversationShortId: String(raw['conversationShortId'] ?? ''),
    conversationType,
    isGroup: conversationType === 2 || isGroupConversationId(conversationId),
    name: String(ext?.['name'] ?? ''),
    ...(avatar ? { avatar } : {}),
    ...(ownerUid && ownerUid !== '0' ? { ownerUid } : {}),
    lastMessageTime: Number(setting?.['lastMsgTime'] ?? 0),
    members,
    ...(groupNumber ? { groupNumber } : {}),
    // ticket 只随 610 详情下发（列表接口不回填），未取到时保持缺省
    ...(raw['ticket'] ? { ticket: String(raw['ticket']) } : {}),
  }
}

/** 从 conversationId 解析对端 uid（私信格式 0:1:{uid_a}:{uid_b}） */
function parsePeerFromConversationId (conversationId: string, myUid: string): string {
  const parts = conversationId.split(':')
  if (parts.length >= 4 && parts[1] === '1') {
    const uidA = parts[2]!
    const uidB = parts[3]!
    if (uidA === myUid) return uidB
    if (uidB === myUid) return uidA
    return uidB
  }
  return ''
}

/** 从 conversation 元数据构建 thread（peer 资料取 firstPageParticipants/userInfo 的 alias） */
function mapProtoConversationMeta (
  conv: Record<string, unknown>,
  messages: Record<string, unknown>[],
  myUid: string,
): PrivateThread {
  const threadId = (conv['conversationId'] as string) ?? ''
  const conversationType = (conv['conversationType'] as number) ?? 1
  const peerUid = parsePeerFromConversationId(threadId, myUid)

  const participantPage = (conv['firstPageParticipants'] ?? conv['members']) as
    | { members?: Array<Record<string, unknown>>; participants?: Array<Record<string, unknown>> }
    | undefined
  const userInfo = conv['userInfo'] as Record<string, unknown> | undefined
  const candidates = participantPage?.participants ?? participantPage?.members ?? []
  const peerMember = candidates.find(
    (member) => String(member['userId'] ?? member['uid'] ?? '') === peerUid,
  )
  const peerInfo = peerMember ??
    (String(userInfo?.['userId'] ?? userInfo?.['uid'] ?? '') === peerUid ? userInfo : undefined)
  const peerSecUid = String(peerInfo?.['secUid'] ?? '')
  const peerNick = String(peerInfo?.['alias'] ?? peerInfo?.['nickname'] ?? '')

  const thread: PrivateThread = {
    threadId,
    ...(conv['conversationShortId'] != null
      ? { conversationShortId: String(conv['conversationShortId']) }
      : {}),
    conversationType,
    peer: {
      uid: peerUid,
      nickname: peerNick,
      ...(peerSecUid ? { secUid: peerSecUid } : {}),
    },
    unreadCount: Number(conv['badgeCount'] ?? conv['unreadCount'] ?? 0),
    updateTime: Number(
      (conv['extInfo'] as Record<string, unknown> | undefined)?.['lastActiveTime'] ?? 0,
    ),
    ...(conv['inboxType'] != null ? { inboxType: conv['inboxType'] as number } : {}),
  }

  const lastMsg = messages.find((m) => (m['conversationId'] as string) === threadId)
  if (lastMsg) {
    thread.lastMessage = mapProtoMessage(lastMsg)
    if (!thread.updateTime) thread.updateTime = thread.lastMessage.createTime
  }

  return thread
}

/** 从单条 message 记录构建 thread（无 conversations 字段时） */
function mapProtoConversation (raw: Record<string, unknown>, myUid: string): PrivateThread {
  const threadId = (raw['conversationId'] as string) ?? ''
  const conversationType = (raw['conversationType'] as number) ?? 1
  const peerUid = parsePeerFromConversationId(threadId, myUid) ||
    (conversationType === 1 ? String(raw['sender'] ?? '') : '')
  const ext = raw['ext'] as Record<string, string> | undefined
  const thread: PrivateThread = {
    threadId,
    ...(raw['conversationShortId'] != null
      ? { conversationShortId: String(raw['conversationShortId']) }
      : {}),
    conversationType,
    peer: {
      uid: peerUid,
      nickname: '',
      ...(raw['secSender'] && String(raw['sender']) === peerUid
        ? { secUid: String(raw['secSender']) }
        : {}),
    },
    unreadCount: 0,
    updateTime: (raw['createTime'] as number) ?? 0,
    ...(ext?.['s:is_stranger'] === 'true' ? { isStranger: true } : {}),
  }
  if (raw['content']) {
    thread.lastMessage = mapProtoMessage(raw)
  }
  return thread
}

function dedupeThreads (threads: PrivateThread[]): PrivateThread[] {
  const byId = new Map<string, PrivateThread>()
  for (const t of threads) {
    const prev = byId.get(t.threadId)
    if (!prev || t.updateTime >= prev.updateTime) {
      byId.set(t.threadId, t)
    }
  }
  return [...byId.values()]
}

function mapProtoMessage (raw: Record<string, unknown>): ChatMessage {
  const senderSecUid = String(raw['secSender'] ?? '')
  const indexInConversation = String(raw['indexInConversation'] ?? '')
  const indexInConversationV2 = String(raw['indexInConversationV2'] ?? '')
  return {
    msgId: String(raw['serverMessageId'] ?? ''),
    threadId: (raw['conversationId'] as string) ?? '',
    senderUid: String(raw['sender'] ?? ''),
    ...(senderSecUid ? { senderSecUid } : {}),
    content: (raw['content'] as string) ?? '',
    msgType: (raw['messageType'] as number) ?? 0,
    createTime: (raw['createTime'] as number) ?? 0,
    status: (raw['status'] as number) ?? 0,
    ...(indexInConversation ? { indexInConversation } : {}),
    ...(indexInConversationV2 ? { indexInConversationV2 } : {}),
  }
}

/** P2P 会话线程 → 好友信息 */
function mapThreadToFriend (thread: PrivateThread): FriendInfo | undefined {
  const peer = thread.peer as ThreadPeer
  if (!peer.uid || !/^\d+$/.test(peer.uid)) return undefined
  return {
    uid: peer.uid,
    ...(peer.secUid ? { secUid: peer.secUid } : {}),
    nickname: peer.nickname ?? '',
    conversationId: thread.threadId,
    conversationShortId: thread.conversationShortId ?? '',
    ...(thread.lastMessage ? { lastMessage: thread.lastMessage } : {}),
    lastMessageTime: thread.lastMessage?.createTime ?? thread.updateTime,
    unreadCount: thread.unreadCount,
  }
}

/** 陌生人会话线程 → 陌生人信息 */
function mapThreadToStranger (thread: PrivateThread): StrangerInfo | undefined {
  const peer = thread.peer as ThreadPeer
  if (!peer.uid) return undefined
  return {
    uid: peer.uid,
    ...(peer.secUid ? { secUid: peer.secUid } : {}),
    ...(peer.nickname ? { nickname: peer.nickname } : {}),
    conversationId: thread.threadId,
    conversationShortId: thread.conversationShortId ?? '',
    ...(thread.lastMessage ? { lastMessage: thread.lastMessage } : {}),
    lastMessageTime: thread.lastMessage?.createTime ?? thread.updateTime,
    unreadCount: thread.unreadCount,
  }
}

/* ---------------------------------------------------------------------------
 * 会话动作
 * ------------------------------------------------------------------------- */

interface ActionBody {
  status?: number
  extraInfo?: string
  checkCode?: number | string
  checkMessage?: string
}

function parseActionCheckMessage (value: string): { parsed: boolean; code?: number; message?: string } {
  if (!value.trim()) return { parsed: false }
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>
    const rawCode = parsed['status_code'] ?? parsed['statusCode']
    const code = rawCode === undefined ? undefined : Number(rawCode)
    const message = [
      parsed['status_msg'],
      parsed['statusMsg'],
      parsed['tips'],
      parsed['toast'],
      parsed['message'],
    ].map((item) => String(item ?? '')).find(Boolean)
    return {
      parsed: true,
      ...(code !== undefined && Number.isFinite(code) ? { code } : {}),
      ...(message ? { message } : {}),
    }
  } catch {
    return { parsed: false }
  }
}

/** Desktop Cookie 会话动作统一响应归一 */
export function actionResponse (
  decoded: Record<string, unknown>,
  bodyKey?: string,
): ActionResult {
  const envelopeStatus = Number(decoded['statusCode'] ?? 0)
  const payload = decoded['body'] as Record<string, unknown> | undefined
  const body = (bodyKey ? payload?.[bodyKey] : undefined) as ActionBody | undefined
  const actionStatus = Number(body?.status ?? 0)
  const checkMessage = String(body?.checkMessage ?? '')
  const checkDetail = parseActionCheckMessage(checkMessage)
  const checkCode = checkDetail.code ?? Number(body?.checkCode ?? 0)
  const statusCode = envelopeStatus || checkCode || actionStatus
  const statusMsg = [
    checkDetail.message,
    checkDetail.parsed ? '' : checkMessage,
    body?.extraInfo,
    decoded['errorDesc'],
  ]
    .map((value) => String(value ?? ''))
    .find(Boolean) ?? ''
  return {
    statusCode,
    statusMsg,
    ...(checkCode ? { checkCode } : {}),
  }
}

/** cmd=705, /v1/message/set_property — 消息表情回应（operation 0=添加 1=移除） */
export async function modifyReaction (
  ctx: InboxContext,
  options: ModifyReactionItem,
): Promise<{ statusCode: number; statusMsg: string }> {
  const decoded = await ctx.transport.sendCookieProto(
    705,
    options.inboxType ?? 0,
    '/v1/message/set_property',
    {
      modifyMessageProperty: {
        propertyList: [{
          conversationId: options.conversationId,
          conversationType: options.conversationType ?? 1,
          conversationShortId: LONG.fromString(options.conversationShortId || '0'),
          serverMessageId: LONG.fromString(options.serverMessageId),
          clientMessageId: '',
          modifyPropertyContent: [{
            operation: options.enabled ? 0 : 1,
            key: `se:${options.emoji}`,
            value: '',
            idempotentId: options.operatorUid,
          }],
        }],
        ticket: '',
      },
    },
    ctx.deviceId,
  )
  const envelopeStatus = Number(decoded['statusCode'] ?? 0)
  // statusCode=1 表示已应用（幂等），对齐 douyin-im 视为成功
  return {
    statusCode: envelopeStatus === 1 ? 0 : envelopeStatus,
    statusMsg: String(decoded['errorDesc'] ?? ''),
  }
}

/** 会话标记已读：cmd=2002 mark_conversation_read（对齐 native rawMarkConversationRead，body oneof tag 604） */
export async function markConversationRead (
  ctx: InboxContext,
  options: MarkReadItem,
): Promise<{ statusCode: number; statusMsg: string }> {
  const send = async (endpoint: string): Promise<Record<string, unknown>> =>
    ctx.transport.sendCookieProto(
      2002,
      options.inboxType ?? 1,
      endpoint,
      {
        markConversationRead: {
          conversationId: options.conversationId,
          conversationShortId: LONG.fromString(options.conversationShortId || '0'),
          conversationType: options.conversationType ?? 1,
          readMessageIndex: LONG.fromString(options.readMessageIndex ?? '0'),
          readMessageIndexV2: LONG.fromString(options.readMessageIndexV2 ?? '0'),
          convUnreadCount: LONG.fromString('0'),
          totalUnreadCount: LONG.fromString('0'),
          readBadgeCount: 0,
          serverMessageId: LONG.fromString(options.serverMessageId ?? '0'),
          ticket: '',
        },
      },
      ctx.deviceId,
    )

  // 国内 imapi3-normal 走 /v1；国际版参考路径为 /v3，状态非 0 时降级重试一次
  let decoded = await send('/v1/conversation/mark_read')
  if (Number(decoded['statusCode'] ?? 0) !== 0 && Number(decoded['statusCode'] ?? 0) !== 1) {
    decoded = await send('/v3/conversation/mark_read')
  }
  const envelopeStatus = Number(decoded['statusCode'] ?? 0)
  // statusCode=1 表示已应用（幂等），对齐 douyin-im 视为成功
  return {
    statusCode: envelopeStatus === 1 ? 0 : envelopeStatus,
    statusMsg: String(decoded['errorDesc'] ?? ''),
  }
}

/** cmd=702, /v1/message/recall — 撤回已投递消息 */
export async function recall (
  ctx: InboxContext,
  options: RecallItem,
): Promise<RecallResult> {
  const decoded = await ctx.transport.sendCookieProto(
    702,
    options.inboxType ?? 0,
    '/v1/message/recall',
    {
      recallMessage: {
        conversationId: options.conversationId,
        conversationShortId: LONG.fromString(options.conversationShortId || '0'),
        conversationType: options.conversationType ?? 1,
        serverMessageId: LONG.fromString(options.serverMessageId),
      },
    },
    ctx.deviceId,
  )
  const envelopeStatus = Number(decoded['statusCode'] ?? 0)
  const body = decoded['body'] as Record<string, unknown> | undefined
  const recallBody = body?.['recallMessage'] as { status?: number } | undefined
  const actionStatus = recallBody?.status ?? 0
  return {
    statusCode: envelopeStatus || actionStatus,
    statusMsg: String(decoded['errorDesc'] ?? ''),
    recalled: envelopeStatus === 0 && actionStatus === 0,
  }
}

/* ---------------------------------------------------------------------------
 * 会话列表 / 历史消息
 * ------------------------------------------------------------------------- */

/** cmd=2006, /v1/conversation/list — Cookie 通道会话列表,循环翻页拉全量
 * 实证：响应 conversationList 不回传翻页游标,服务端按请求 cursor 做 offset 式推进,不足一页即到底 */
export async function listConversations (
  ctx: InboxContext,
  options: InboxListOptions = {},
): Promise<GroupInfo[]> {
  const all: GroupInfo[] = []
  let cursor = options.cursor ?? 0
  const seenShortIds = new Set<string>()
  for (;;) {
    const limit = options.count ?? 20
    const decoded = await ctx.transport.sendCookieProto(
      2006,
      0,
      '/v1/conversation/list',
      {
        conversationList: {
          listType: 1,
          cursor,
          sortType: 2,
          limit,
        },
      },
      ctx.deviceId,
    )
    const statusCode = Number(decoded['statusCode'] ?? 0)
    if (statusCode !== 0) throw new Error(`listConversations failed: ${String(decoded['errorDesc'] ?? '')} (code=${statusCode})`)
    const body = decoded['body'] as Record<string, unknown> | null
    const list = body?.['conversationList'] as {
      conversations?: Array<Record<string, unknown>>
    } | undefined
    const conversations = list?.conversations ?? []
    // 服务端忽略 cursor 时恒回同一批,按 shortId 去重防重复累积
    const fresh = conversations.filter((c) => {
      const id = String(c['conversationShortId'] ?? '')
      return id !== '' && !seenShortIds.has(id) && (seenShortIds.add(id), true)
    })
    all.push(...fresh.map(mapProtoConversationListItem))
    if (conversations.length < limit || fresh.length === 0) break
    cursor += conversations.length
  }
  return all
}

function sleep (ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** Desktop Cookie cmd=203。实测 inboxType=1 返回群聊及普通私信;不依赖 Creator IM token。循环翻页拉全量。 */
export async function listCookieThreads (
  ctx: InboxContext,
  options: InboxListOptions & { inboxType?: number } = {},
): Promise<PrivateThread[]> {
  const limit = options.count ?? 20
  let cursor = options.cursor ?? 0
  const seenCursors = new Set<number>()
  const threads: PrivateThread[] = []
  for (;;) {
    // cursor 不推进即停止,防服务端翻页字段缺失/异常导致的死循环
    if (seenCursors.has(cursor)) break
    seenCursors.add(cursor)
    let lastError: unknown
    let decoded: Record<string, unknown> | undefined
    // 服务端偶发 StatusCodeRPCTimeout(500)，重试 2 次缓解
    for (let attempt = 0; attempt < 3 && !decoded; attempt++) {
      try {
        const res = await ctx.transport.sendCookieProto(
          203,
          options.inboxType ?? 1,
          '/v2/message/get_by_user_init',
          { inbox: { convLimit: limit, msgLimit: limit, cursor } },
          ctx.deviceId,
        )
        if (Number(res['statusCode'] ?? 0) !== 0) {
          lastError = new Error(`listCookieThreads failed: ${String(res['errorDesc'] ?? '')} (code=${Number(res['statusCode'])})`)
          await sleep(1000)
          continue
        }
        decoded = res
      } catch (err) {
        lastError = err
        await sleep(1000)
      }
    }
    if (!decoded) throw lastError instanceof Error ? lastError : new Error('listCookieThreads failed')
    const body = decoded['body'] as Record<string, unknown> | null
    const inbox = body?.['inbox'] as {
      messages?: unknown[]
      conversations?: unknown[]
      hasMore?: boolean | number
      cursor?: string | number | { toString (): string }
    } | null
    const rawMessages = (inbox?.messages ?? []) as Record<string, unknown>[]
    const rawConversations = (inbox?.conversations ?? []) as Record<string, unknown>[]
    threads.push(...(rawConversations.length > 0
      ? rawConversations.map((conversation) =>
        mapProtoConversationMeta(conversation, rawMessages, ctx.platformUid),
      )
      : rawMessages.map((message) => mapProtoConversation(message, ctx.platformUid))))
    if (!inbox?.hasMore || Number(inbox.hasMore) === 0) break
    const next = Number(String(inbox.cursor ?? ''))
    if (!Number.isFinite(next) || next === 0 || next === cursor) break
    cursor = next
  }
  return dedupeThreads(threads)
}

/** cmd=2047, /v1/message/get_recent_stranger_message — 陌生人消息（Desktop Cookie 通道；接口无分页字段） */
export async function listStrangerThreads (
  ctx: InboxContext,
): Promise<PrivateThread[]> {
  const decoded = await ctx.transport.sendCookieProto(
    2047,
    1,
    '/v1/message/get_recent_stranger_message',
    {
      getRecentStrangerMessage: {
        latestStrangerVersion: LONG.fromString('0'),
        earliestStrangerVersion: LONG.fromString('0'),
        source: 'code_up',
        newUser: 0,
        bizInfo: '',
      },
    },
    ctx.deviceId,
  )

  const statusCode = Number(decoded['statusCode'] ?? 0)
  if (statusCode !== 0) {
    throw new Error(`listStrangerThreads failed: ${String(decoded['errorDesc'] ?? '')} (code=${statusCode})`)
  }

  const body = decoded['body'] as Record<string, unknown> | null
  const page = body?.['getRecentStrangerMessage'] as { messages?: unknown[] } | null
  const rows = (page?.messages ?? []) as Record<string, unknown>[]
  const rawMessages = rows.flatMap(row => (row['messages'] ?? []) as Record<string, unknown>[])
  return dedupeThreads(rawMessages.map(message => mapProtoConversation(message, ctx.platformUid)))
}

/** cmd=301, /v1/message/get_by_conversation — 会话历史消息 */
export async function getChatHistory (
  ctx: InboxContext,
  options: ConversationAddress & { cursor?: number; count?: number },
): Promise<ChatMessage[]> {
  const decoded = await ctx.transport.sendCookieProto(
    301,
    1,
    '/v1/message/get_by_conversation',
    {
      conversationMessages: {
        conversationId: options.conversationId,
        conversationType: options.conversationType,
        conversationShortId: LONG.fromString(options.conversationShortId),
        direction: 1,
        anchorIndex: options.cursor ?? 0,
        limit: options.count ?? 20,
      },
    },
    ctx.deviceId,
  )

  const statusCode = Number(decoded['statusCode'] ?? 0)
  if (statusCode !== 0) {
    throw new Error(`getChatHistory failed: ${String(decoded['errorDesc'] ?? '')} (code=${statusCode})`)
  }

  const body = decoded['body'] as Record<string, unknown> | null
  const cm = body?.['conversationMessages'] as {
    messages?: unknown[]
  } | null

  return (cm?.messages ?? []).map((m) => mapProtoMessage(m as Record<string, unknown>))
}

/* ---------------------------------------------------------------------------
 * 联系人业务视图
 * ------------------------------------------------------------------------- */

/** 好友（旧实现：Desktop Cookie 会话 P2P 派生,保留备用） */
export async function listFriendThreads (
  ctx: InboxContext,
  options: InboxListOptions = {},
): Promise<FriendInfo[]> {
  const threads = await listCookieThreads(ctx, options)
  return threads
    .filter((thread) => thread.conversationType === 1 || thread.conversationType === undefined)
    .map(mapThreadToFriend)
    .filter((friend): friend is FriendInfo => friend != null)
}

/** familiar/list 单行身份 */
interface FamiliarRow {
  uid: string
  secUid?: string
  nickname: string
}

/** familiar/list 响应页（HAR 实测 cursor + has_more 翻页,user_list 为好友行） */
interface FamiliarPage {
  status_code?: number
  user_list?: Array<Record<string, unknown>>
  cursor?: number
  has_more?: boolean
}

/** familiar/list 单行 → 好友身份（remark_name 优先作昵称；uid 非纯数字丢弃） */
function familiarRow (raw: Record<string, unknown>): FamiliarRow | undefined {
  const uid = String(raw['uid'] ?? '')
  if (!/^\d+$/.test(uid)) return undefined
  const secUid = String(raw['sec_uid'] ?? '')
  return {
    uid,
    ...(secUid ? { secUid } : {}),
    nickname: String(raw['remark_name'] ?? raw['nickname'] ?? ''),
  }
}

/** GET /aweme/v1/web/familiar/list/ 循环翻页拉全量好友身份 */
async function fetchFamiliarRows (
  ctx: InboxContext,
  options: InboxListOptions = {},
): Promise<FamiliarRow[]> {
  const rows: FamiliarRow[] = []
  const seen = new Set<string>()
  let cursor = options.cursor ?? 0
  for (; ;) {
    const params = fingerprintParams(ctx.http.deviceId, ctx.http.guid)
    params.set('cursor', String(cursor))
    params.set('vcd_count', '0')
    params.set('hotsoon_has_more', '0')
    params.set('only_total', '0')
    params.set('count', String(options.count ?? 100))
    params.set('order_by', '1')
    params.set('need_all_friend', '1')
    params.set('recommend_type', '22')
    const res = await ctx.http.json<FamiliarPage>(
      `https://imdesktop.douyin.com/aweme/v1/web/familiar/list/?${params}`,
      { headers: { Referer: 'https://imdesktop.douyin.com' } },
    )
    const page = res.data
    if (Number(page?.status_code ?? 0) !== 0) break
    for (const raw of page.user_list ?? []) {
      const row = familiarRow(raw)
      if (row && !seen.has(row.uid)) {
        seen.add(row.uid)
        rows.push(row)
      }
    }
    if (!page.has_more) break
    const next = Number(page.cursor ?? 0)
    if (!Number.isFinite(next) || next === cursor) break
    cursor = next
  }
  return rows
}

/** 好友列表：真实接口 familiar/list；无会话 ID,按 uid 交叉匹配会话补齐 */
export async function getFriendList (
  ctx: InboxContext,
  options: InboxListOptions = {},
): Promise<FriendInfo[]> {
  const [rows, threads] = await Promise.all([
    fetchFamiliarRows(ctx, options),
    listCookieThreads(ctx, { count: options.count }).catch(() => [] as PrivateThread[]),
  ])
  const byUid = new Map<string, PrivateThread>()
  for (const thread of threads) {
    if (thread.peer.uid && !byUid.has(thread.peer.uid)) byUid.set(thread.peer.uid, thread)
  }
  return rows.map((row) => {
    const thread = byUid.get(row.uid)
    return {
      uid: row.uid,
      ...(row.secUid ? { secUid: row.secUid } : {}),
      nickname: row.nickname,
      // familiar/list 不含会话 ID；无历史会话的好友 conversationId 留空（chatId 形如 1::,仅发送时抛错）
      conversationId: thread?.threadId ?? '',
      conversationShortId: thread?.conversationShortId ?? '',
      ...(thread?.lastMessage ? { lastMessage: thread.lastMessage } : {}),
      lastMessageTime: thread?.lastMessage?.createTime ?? thread?.updateTime ?? 0,
      unreadCount: thread?.unreadCount ?? 0,
    }
  })
}

/** 旧 Cookie 通道会话列表（cmd 2006 /v1/conversation/list,再按 type=2 取群会话;群列表主用 listNativeGroups,此处保留备用） */
export async function listConversationsByCookie (
  ctx: InboxContext,
  options: InboxListOptions = {},
): Promise<GroupInfo[]> {
  const conversations = await listConversations(ctx, options)
  return conversations.filter((conversation) => conversation.isGroup)
}

/** 群列表：原生通道 cmd=2006 /v1/conversation/list（imapi.douyin.com,对齐官方 PC 群列表） */
export async function listNativeGroups (
  ctx: InboxContext,
  options: InboxListOptions = {},
): Promise<GroupInfo[]> {
  const all: GroupInfo[] = []
  let cursor = options.cursor ?? 0
  const seenShortIds = new Set<string>()
  for (; ;) {
    const limit = options.count ?? 20
    const decoded = await ctx.transport.sendNativeProto(
      2006,
      0,
      '/v1/conversation/list',
      { conversationList: { listType: 1, cursor, sortType: 2, limit } },
      ctx.deviceId,
    )
    const statusCode = Number(decoded['statusCode'] ?? 0)
    if (statusCode !== 0) throw new Error(`listNativeGroups failed: ${String(decoded['errorDesc'] ?? '')} (code=${statusCode})`)
    const body = decoded['body'] as Record<string, unknown> | null
    const list = body?.['conversationList'] as { conversations?: Array<Record<string, unknown>> } | undefined
    const conversations = list?.conversations ?? []
    const fresh = conversations.filter((c) => {
      const id = String(c['conversationShortId'] ?? '')
      return id !== '' && !seenShortIds.has(id) && (seenShortIds.add(id), true)
    })
    all.push(...fresh.map(mapProtoConversationListItem))
    if (conversations.length < limit || fresh.length === 0) break
    cursor += conversations.length
  }
  return all.filter((conversation) => conversation.isGroup)
}

/** 群列表：原生通道全量群会话 */
export async function getGroupList (
  ctx: InboxContext,
  options: InboxListOptions = {},
): Promise<GroupInfo[]> {
  return listNativeGroups(ctx, options)
}

/** 群成员列表：cmd=605 分页拉全量 */
export async function getGroupMembers (
  ctx: InboxContext,
  options: ConversationAddress,
): Promise<GroupMemberInfo[]> {
  const members: GroupMemberInfo[] = []
  let cursor = '0'
  const seenCursors = new Set<string>()
  for (; ;) {
    if (seenCursors.has(cursor)) {
      throw new Error('participant cursor did not advance')
    }
    seenCursors.add(cursor)
    const decoded = await ctx.transport.sendCookieProto(
      605,
      options.inboxType ?? 0,
      '/v1/conversation/participants_list',
      {
        conversationParticipants: {
          conversationId: options.conversationId,
          conversationShortId: LONG.fromString(options.conversationShortId),
          conversationType: options.conversationType,
          cursor: LONG.fromString(cursor),
          limit: 100,
        },
      },
      ctx.deviceId,
    )
    const result = actionResponse(decoded, 'conversationParticipants')
    if (result.statusCode !== 0) throw new Error(`getGroupMembers failed: ${result.statusMsg} (code=${result.statusCode})`)
    const payload = decoded['body'] as Record<string, unknown> | undefined
    const body = payload?.['conversationParticipants'] as {
      participantsPage?: {
        participants?: Array<Record<string, unknown>>
        hasMore?: boolean
        cursor?: string | number | { toString (): string }
      }
    } | undefined
    const participantPage = body?.participantsPage
    for (const participant of participantPage?.participants ?? []) {
      const uid = String(participant['userId'] ?? '')
      if (!uid) continue
      const secUid = String(participant['secUid'] ?? '')
      const alias = String(participant['alias'] ?? '')
      const sortOrder = String(participant['sortOrder'] ?? '')
      const leftBlockTime = String(participant['leftBlockTime'] ?? '')
      const ext = participant['ext']
      members.push({
        uid,
        role: Number(participant['role'] ?? 0),
        ...(secUid ? { secUid } : {}),
        ...(alias ? { alias } : {}),
        ...(sortOrder ? { sortOrder } : {}),
        ...(participant['blocked'] !== undefined ? { blocked: Number(participant['blocked']) } : {}),
        ...(leftBlockTime ? { leftBlockTime } : {}),
        ...(ext && typeof ext === 'object' ? { ext: ext as Record<string, string> } : {}),
      })
    }
    if (!participantPage?.hasMore) return members
    const nextCursor = String(participantPage.cursor ?? '')
    if (!nextCursor) throw new Error('participant cursor did not advance')
    cursor = nextCursor
  }
}

/** 陌生人会话列表 */
export async function getStrangerList (
  ctx: InboxContext,
): Promise<StrangerInfo[]> {
  const threads = await listStrangerThreads(ctx)
  return threads
    .map(mapThreadToStranger)
    .filter((stranger): stranger is StrangerInfo => stranger != null)
}

/* ---------------------------------------------------------------------------
 * 好友申请 / 入群申请（列表 + 审批）
 * ------------------------------------------------------------------------- */

function joinRequestData (value: Record<string, unknown> | undefined): GroupJoinRequestInfo | undefined {
  if (!value) return undefined
  const requestId = String(value['applyId'] ?? '')
  const applicantUid = String(value['userId'] ?? '')
  const groupShortId = String(value['convShortId'] ?? '')
  if (!requestId || !applicantUid || !groupShortId) return undefined
  const applicantSecUid = String(value['secUid'] ?? '')
  const reason = String(value['applyReason'] ?? '')
  const inviterUid = String(value['inviteUserId'] ?? '')
  const inviterSecUid = String(value['secInviteUid'] ?? '')
  const createdAt = String(value['createTime'] ?? '')
  const modifiedAt = String(value['modifyTime'] ?? '')
  const moderatorUid = String(value['modifyUser'] ?? '')
  const ext = value['ext']
  return {
    requestId,
    applicantUid,
    groupShortId,
    conversationType: Number(value['conversationType'] ?? 2),
    status: Number(value['applyStatus'] ?? GroupJoinRequestStatus.PENDING) as GroupJoinRequestStatus,
    ...(applicantSecUid ? { applicantSecUid } : {}),
    ...(reason ? { reason } : {}),
    ...(inviterUid && inviterUid !== '0' ? { inviterUid } : {}),
    ...(inviterSecUid ? { inviterSecUid } : {}),
    ...(createdAt && createdAt !== '0' ? { createdAt } : {}),
    ...(modifiedAt && modifiedAt !== '0' ? { modifiedAt } : {}),
    ...(moderatorUid && moderatorUid !== '0' ? { moderatorUid } : {}),
    ...(ext && typeof ext === 'object' ? { ext: ext as Record<string, string> } : {}),
  }
}

function friendRequestData (value: Record<string, unknown> | undefined): FriendRequestInfo | undefined {
  if (!value) return undefined
  const applicantUid = String(value['userId'] ?? '')
  if (!applicantUid || applicantUid === '0') return undefined
  const profile = value['profile'] as Record<string, unknown> | undefined
  const ext = value['ext']
  const extRecord = ext && typeof ext === 'object' ? ext as Record<string, string> : undefined
  const nickname = String(profile?.['nickName'] ?? '')
  const avatar = String(profile?.['protrait'] ?? '')
  const requestedAt = String(value['applyTimeSecond'] ?? '')
  const message = String(
    extRecord?.['apply_reason'] ?? extRecord?.['applyReason'] ?? extRecord?.['message'] ?? '',
  )
  return {
    applicantUid,
    status: Number(value['status'] ?? FriendRequestStatus.PENDING) as FriendRequestStatus,
    ...(nickname ? { nickname } : {}),
    ...(avatar ? { avatar } : {}),
    ...(requestedAt && requestedAt !== '0' ? { requestedAt } : {}),
    ...(message ? { message } : {}),
    ...(extRecord ? { ext: extRecord } : {}),
  }
}

/** cmd=2027, /v1/conversation/get_audit_list — 入群申请列表 */
export async function getGroupJoinRequests (
  ctx: InboxContext,
  options: { conversationShortId?: string } = {},
): Promise<GroupJoinRequestInfo[]> {
  const requests: GroupJoinRequestInfo[] = []
  let cursor = '0'
  const seenCursors = new Set<string>()
  for (; ;) {
    if (seenCursors.has(cursor)) {
      throw new Error('join-request cursor did not advance')
    }
    seenCursors.add(cursor)
    const decoded = await ctx.transport.sendCookieProto(
      2027,
      1,
      '/v1/conversation/get_audit_list',
      {
        getConversationAuditList: {
          cursor: LONG.fromString(cursor),
          limit: 100,
        },
      },
      ctx.deviceId,
    )
    const result = actionResponse(decoded)
    if (result.statusCode !== 0) throw new Error(`getGroupJoinRequests failed: ${result.statusMsg} (code=${result.statusCode})`)
    const payload = decoded['body'] as Record<string, unknown> | undefined
    const body = payload?.['getConversationAuditList'] as {
      applyInfoList?: Array<Record<string, unknown>>
      nextCursor?: string | number | { toString (): string }
      hasMore?: boolean
    } | undefined
    for (const raw of body?.applyInfoList ?? []) {
      const request = joinRequestData(raw)
      if (request && (!options.conversationShortId || request.groupShortId === options.conversationShortId)) {
        requests.push(request)
      }
    }
    if (!body?.hasMore) return requests
    const nextCursor = String(body.nextCursor ?? '')
    if (!nextCursor) throw new Error('join-request cursor did not advance')
    cursor = nextCursor
  }
}

/** cmd=902, /v1/conversation/set_conversation_core_info — 设置群名 */
export async function setGroupName (
  ctx: InboxContext,
  address: ConversationAddress,
  name: string,
): Promise<ActionResult> {
  const decoded = await ctx.transport.sendCookieProto(
    902,
    1,
    '/v1/conversation/set_conversation_core_info',
    {
      setConversationCoreInfo: {
        conversationId: address.conversationId,
        conversationShortId: address.conversationShortId
          ? LONG.fromString(address.conversationShortId)
          : undefined,
        conversationType: address.conversationType,
        name,
        isNameSet: true,
      },
    },
    ctx.deviceId,
  )
  return actionResponse(decoded, 'setConversationCoreInfo')
}

/* ---------------------------------------------------------------------------
 * 群成员 / 会话操作（add/remove/leave/delete）—— 群成员变动事件的主动侧
 * ------------------------------------------------------------------------- */

/** cmd=650, /v1/conversation/add_participants — 拉人入群 */
export async function addGroupMembers (
  ctx: InboxContext,
  address: ConversationAddress,
  uids: string[],
): Promise<ActionResult & { success?: string[]; failed?: string[] }> {
  const decoded = await ctx.transport.sendCookieProto(
    650,
    address.inboxType ?? 1,
    '/v1/conversation/add_participants',
    {
      conversationAddParticipants: {
        conversationId: address.conversationId,
        conversationShortId: address.conversationShortId
          ? LONG.fromString(address.conversationShortId)
          : undefined,
        conversationType: address.conversationType,
        participants: uids.map((uid) => LONG.fromString(uid)),
        bizExt: {
          invitation: JSON.stringify({
            invitee: { source_app_id: 6383 },
            invitor: { im_user_id: Number(ctx.platformUid) },
            source_type: 6,
          }),
          source_type: '6',
          ticket: '',
        },
      },
    },
    ctx.deviceId,
  )
  const result = actionResponse(decoded, 'conversationAddParticipants')
  const payload = decoded['body'] as Record<string, unknown> | undefined
  const body = payload?.['conversationAddParticipants'] as {
    successParticipants?: Array<{ toString (): string }>
    failedParticipants?: Array<{ toString (): string }>
  } | undefined
  return {
    ...result,
    ...(body?.successParticipants?.length ? { success: body.successParticipants.map(String) } : {}),
    ...(body?.failedParticipants?.length ? { failed: body.failedParticipants.map(String) } : {}),
  }
}

/** cmd=651, /v1/conversation/remove_participants — 移出群成员 */
export async function removeGroupMembers (
  ctx: InboxContext,
  address: ConversationAddress,
  uids: string[],
): Promise<ActionResult> {
  const decoded = await ctx.transport.sendCookieProto(
    651,
    address.inboxType ?? 1,
    '/v1/conversation/remove_participants',
    {
      conversationRemoveParticipants: {
        conversationId: address.conversationId,
        conversationShortId: address.conversationShortId
          ? LONG.fromString(address.conversationShortId)
          : undefined,
        conversationType: address.conversationType,
        participants: uids.map((uid) => LONG.fromString(uid)),
      },
    },
    ctx.deviceId,
  )
  return actionResponse(decoded, 'conversationRemoveParticipants')
}

/** cmd=652, /v1/conversation/leave — 退出群聊（响应为空 body） */
export async function leaveGroup (
  ctx: InboxContext,
  address: ConversationAddress,
): Promise<ActionResult> {
  const decoded = await ctx.transport.sendCookieProto(
    652,
    address.inboxType ?? 1,
    '/v1/conversation/leave',
    {
      leaveConversation: {
        conversationId: address.conversationId,
        conversationShortId: address.conversationShortId
          ? LONG.fromString(address.conversationShortId)
          : undefined,
        conversationType: address.conversationType,
      },
    },
    ctx.deviceId,
  )
  return actionResponse(decoded, 'leaveConversation')
}

/** cmd=603, /v1/conversation/delete — 删除会话（响应为空 body） */
export async function deleteConversation (
  ctx: InboxContext,
  address: ConversationAddress,
  options: { lastMessageIndex?: string } = {},
): Promise<ActionResult> {
  const decoded = await ctx.transport.sendCookieProto(
    603,
    address.inboxType ?? 1,
    '/v1/conversation/delete',
    {
      deleteConversation: {
        conversationId: address.conversationId,
        conversationShortId: address.conversationShortId
          ? LONG.fromString(address.conversationShortId)
          : undefined,
        conversationType: address.conversationType,
        lastMessageIndex: LONG.fromString(options.lastMessageIndex ?? '0'),
        badgeCount: 0,
      },
    },
    ctx.deviceId,
  )
  return actionResponse(decoded, 'deleteConversation')
}

/* ---------------------------------------------------------------------------
 * 会话设置 / 建群（cmd 921/609）
 * ------------------------------------------------------------------------- */

export interface ConversationSettingInput {
  setStickOnTop?: boolean
  setMute?: boolean
  setFavorite?: boolean
}

/** cmd=921, /v1/conversation/set_setting_info — 会话设置（置顶/免打扰/收藏），响应回读完整设置 */
export async function setConversationSetting (
  ctx: InboxContext,
  address: ConversationAddress,
  input: ConversationSettingInput,
): Promise<ActionResult & { setting?: Record<string, unknown> }> {
  const decoded = await ctx.transport.sendCookieProto(
    921,
    address.inboxType ?? 1,
    '/v1/conversation/set_setting_info',
    {
      setConversationSettingInfo: {
        conversationId: address.conversationId,
        conversationShortId: address.conversationShortId
          ? LONG.fromString(address.conversationShortId)
          : undefined,
        conversationType: address.conversationType,
        ...(input.setStickOnTop != null ? { setStickOnTop: input.setStickOnTop } : {}),
        ...(input.setMute != null ? { setMute: input.setMute } : {}),
        ...(input.setFavorite != null ? { setFavorite: input.setFavorite } : {}),
      },
    },
    ctx.deviceId,
  )
  const result = actionResponse(decoded, 'setConversationSettingInfo')
  const payload = decoded['body'] as Record<string, unknown> | undefined
  const body = payload?.['setConversationSettingInfo'] as {
    conversationSettingInfo?: Record<string, unknown>
  } | undefined
  return {
    ...result,
    ...(body?.conversationSettingInfo ? { setting: body.conversationSettingInfo } : {}),
  }
}

export interface CreateGroupOptions {
  /** 参与成员 uid（含创建者本人） */
  participantUids: string[]
  name?: string
  description?: string
}

/** cmd=609, /v2/conversation/create — 创建群聊，返回创建出的会话 */
export async function createGroup (
  ctx: InboxContext,
  options: CreateGroupOptions,
): Promise<ActionResult & { group?: GroupInfo }> {
  const name = options.name ?? ''
  const description = options.description ?? ''
  const decoded = await ctx.transport.sendCookieProto(
    609,
    1,
    '/v2/conversation/create',
    {
      createConversationV2: {
        conversationType: 2,
        participants: options.participantUids.map((uid) => LONG.fromString(uid)),
        name,
        description,
        bizExt: {
          group_type: '1000',
          show_at_profile: '1',
          group_name: name,
          group_desc: description,
        },
        ext: {
          'a:s_group_type': '1000',
          'a:s_group_category': '2',
        },
      },
    },
    ctx.deviceId,
  )
  const result = actionResponse(decoded, 'createConversationV2')
  const payload = decoded['body'] as Record<string, unknown> | undefined
  const body = payload?.['createConversationV2'] as {
    conversation?: {
      conversationId?: string
      conversationShortId?: string | { toString (): string }
      conversationType?: number
    }
  } | undefined
  const group = body?.conversation
  if (!group) return result
  return {
    ...result,
    group: {
      conversationId: String(group.conversationId ?? ''),
      conversationShortId: String(group.conversationShortId ?? ''),
      conversationType: Number(group.conversationType ?? 2),
      isGroup: true,
      name,
      members: [],
      lastMessageTime: 0,
    },
  }
}

/** cmd=2025, /v1/conversation/ack_apply — 审批入群申请 */
export async function reviewGroupJoinRequest (
  ctx: InboxContext,
  requestId: string,
  status: GroupJoinRequestStatus.APPROVED | GroupJoinRequestStatus.REJECTED,
): Promise<ActionResult & { request?: GroupJoinRequestInfo }> {
  if (!/^\d+$/.test(requestId)) throw new Error('join request id must be numeric')
  const decoded = await ctx.transport.sendCookieProto(
    2025,
    1,
    '/v1/conversation/ack_apply',
    {
      ackConversationApply: {
        applyId: LONG.fromString(requestId),
        applyStatus: status,
        bizExt: {},
      },
    },
    ctx.deviceId,
  )
  const result = actionResponse(decoded, 'ackConversationApply')
  const payload = decoded['body'] as Record<string, unknown> | undefined
  const body = payload?.['ackConversationApply'] as {
    applyInfo?: Record<string, unknown>
  } | undefined
  const request = joinRequestData(body?.applyInfo)
  return { ...result, ...(request ? { request } : {}) }
}

/** cmd=20481, /v1/friend/get_receive_apply_list — 好友申请列表 */
export async function getFriendRequests (
  ctx: InboxContext,
  options: { status?: FriendRequestStatus } = {},
): Promise<FriendRequestInfo[]> {
  const requests: FriendRequestInfo[] = []
  let cursor = '0'
  const seenCursors = new Set<string>()
  for (; ;) {
    if (seenCursors.has(cursor)) {
      throw new Error('friend-request cursor did not advance')
    }
    seenCursors.add(cursor)
    const decoded = await ctx.transport.sendCookieProto(
      20481,
      0,
      '/v1/friend/get_receive_apply_list',
      {
        getFriendReceiveApplyList: {
          cursor: LONG.fromString(cursor),
          limit: LONG.fromString('100'),
          getTotalCount: true,
          status: options.status ?? FriendRequestStatus.PENDING,
        },
      },
      ctx.deviceId,
    )
    const result = actionResponse(decoded)
    if (result.statusCode !== 0) throw new Error(`getFriendRequests failed: ${result.statusMsg} (code=${result.statusCode})`)
    const payload = decoded['body'] as Record<string, unknown> | undefined
    const body = payload?.['getFriendReceiveApplyList'] as {
      nextCursor?: string | number | { toString (): string }
      hasMore?: boolean
      userList?: Array<Record<string, unknown>>
    } | undefined
    for (const raw of body?.userList ?? []) {
      const request = friendRequestData(raw)
      if (request) requests.push(request)
    }
    if (!body?.hasMore) return requests
    const nextCursor = String(body.nextCursor ?? '')
    if (!nextCursor) throw new Error('friend-request cursor did not advance')
    cursor = nextCursor
  }
}

/** cmd=2049, /v1/friend/reply_apply — 审批好友申请 */
export async function reviewFriendRequest (
  ctx: InboxContext,
  applicantUid: string,
  status: FriendRequestStatus.APPROVED | FriendRequestStatus.REJECTED,
): Promise<ActionResult> {
  if (!/^\d+$/.test(applicantUid)) throw new Error('friend request uid must be numeric')
  const decoded = await ctx.transport.sendCookieProto(
    2049,
    0,
    '/v1/friend/reply_apply',
    {
      replyFriendApply: {
        userId: [LONG.fromString(applicantUid)],
        attitude: status,
        ext: {},
      },
    },
    ctx.deviceId,
  )
  return actionResponse(decoded, 'replyFriendApply')
}
