import protobuf from 'protobufjs'
import { actionResponse, mapProtoConversationListItem } from './inbox.js'
import type { InboxContext } from './inbox.js'
import type { ActionResult, ConversationAddress, GroupInfo } from './types.js'
import type { Http } from '../http/client.js'

const LONG = protobuf.util.Long as unknown as { fromString (value: string): unknown }

/* ---------------------------------------------------------------------------
 * 会话信息查询类（cmd 2000/2001/610）—— 服务端 imapi 通道扩展查询
 * ------------------------------------------------------------------------- */

/** cmd=610 get_info_list:按 id 批量查会话详情（ticket/未读/成员），映射对齐列表会话 */
export async function getInfoList (
  ctx: InboxContext,
  items: ConversationAddress[],
): Promise<GroupInfo[]> {
  if (items.length === 0) return []
  const decoded = await ctx.transport.sendCookieProto(
    610,
    items[0]?.inboxType ?? 0,
    '/v2/conversation/get_info_list',
    {
      getConversationInfoListV2: {
        conversationInfoList: items.map((item) => ({
          conversationId: item.conversationId,
          conversationShortId: LONG.fromString(item.conversationShortId || '0'),
          conversationType: item.conversationType,
        })),
      },
    },
    ctx.deviceId,
  )
  const payload = decoded['body'] as
    | { getConversationInfoListV2?: { conversationInfoList?: Record<string, unknown>[] } }
    | undefined
  return (payload?.getConversationInfoListV2?.conversationInfoList ?? [])
    .map(mapProtoConversationListItem)
}

/** 会话成员已读游标行 */
export interface ReadIndexRow {
  uid: string
  /** 已读游标（微秒时间戳量级） */
  readIndex: number
  extra?: number
}

/** cmd=2000 get_read_index:按会话查各成员已读游标 */
export async function getReadIndex (
  ctx: InboxContext,
  item: ConversationAddress,
): Promise<ReadIndexRow[]> {
  const decoded = await ctx.transport.sendCookieProto(
    2000,
    item.inboxType ?? 0,
    '/v3/conversation/get_read_index',
    {
      getReadIndex: {
        conversationShortId: LONG.fromString(item.conversationShortId || '0'),
        conversationType: item.conversationType,
        conversationId: item.conversationId,
      },
    },
    ctx.deviceId,
  )
  const list = ((decoded['body'] as { getReadIndex?: { readIndexList?: unknown[] } } | undefined)
    ?.getReadIndex?.readIndexList ?? []) as Record<string, unknown>[]
  return list.map((raw) => ({
    uid: String(raw['uid'] ?? ''),
    readIndex: Number(raw['readIndex'] ?? 0),
    ...(raw['extra'] != null ? { extra: Number(raw['extra']) } : {}),
  }))
}

/** 会话成员最小同步游标行 */
export interface MinIndexRow {
  uid: string
  minIndex: number
}

/** cmd=2038 batch_get_conversation_participants_readindex:批量查所有成员已读游标（HAR 响应为空 body） */
export async function batchReadIndex (
  ctx: InboxContext,
  item: ConversationAddress,
): Promise<ActionResult> {
  const decoded = await ctx.transport.sendCookieProto(
    2038,
    item.inboxType ?? 1,
    '/v1/conversation/batch_get_conversation_participants_readindex',
    {
      getConversationParticipantsReadIndex: {
        conversationId: item.conversationId,
        conversationShortId: LONG.fromString(item.conversationShortId || '0'),
        getUserReadIndex: 1,
      },
    },
    ctx.deviceId,
  )
  return actionResponse(decoded, 'getConversationParticipantsReadIndex')
}

/** cmd=2001 get_min_index:按会话查各成员最小同步游标（增量拉取起点） */
export async function getMinIndex (
  ctx: InboxContext,
  item: ConversationAddress,
): Promise<MinIndexRow[]> {
  const decoded = await ctx.transport.sendCookieProto(
    2001,
    item.inboxType ?? 0,
    '/v3/conversation/get_min_index',
    {
      getMinIndex: {
        conversationShortId: LONG.fromString(item.conversationShortId || '0'),
        conversationType: item.conversationType,
        conversationId: item.conversationId,
      },
    },
    ctx.deviceId,
  )
  const list = ((decoded['body'] as { getMinIndex?: { minIndexList?: unknown[] } } | undefined)
    ?.getMinIndex?.minIndexList ?? []) as Record<string, unknown>[]
  return list.map((raw) => ({
    uid: String(raw['uid'] ?? ''),
    minIndex: Number(raw['minIndex'] ?? 0),
  }))
}

/* ---------------------------------------------------------------------------
 * 消息游标 / 回执 / 陌生人列表（语义按 HAR 字段树还原，部分字段为推测）
 * ------------------------------------------------------------------------- */

export interface UserMessageQuery {
  /** uid 消息区间（int64 字符串） */
  startIndex?: string
  messageType?: string
  endIndex?: string
  cursor?: string
  inboxType?: number
}

/** cmd=2048 get_user_message:按 uid 消息区间查询（HAR 响应字段全 0，返回原始结构） */
export async function getUserMessage (
  ctx: InboxContext,
  req: UserMessageQuery = {},
): Promise<Record<string, unknown>> {
  const decoded = await ctx.transport.sendCookieProto(
    2048,
    req.inboxType ?? 0,
    '/v1/message/get_user_message',
    {
      getUserMessage: {
        startIndex: LONG.fromString(req.startIndex ?? '0'),
        messageType: LONG.fromString(req.messageType ?? '0'),
        endIndex: LONG.fromString(req.endIndex ?? '0'),
        cursor: req.cursor ?? '',
      },
    },
    ctx.deviceId,
  )
  return ((decoded['body'] as Record<string, unknown> | undefined)?.['getUserMessage'] ??
    {}) as Record<string, unknown>
}

export interface ClientAckItem {
  serverMessageId: string
  clientMessageId?: string
  conversationShortId?: string
  /** 消息类型过滤，缺省 500（到达/已读确认） */
  messageType?: number
  status?: number
  count?: number
  inboxType?: number
}

/** cmd=2010 client/ack:客户端消息回执（type=500 到达/已读确认，响应仅 envelope 成功帧） */
export async function clientAck (
  ctx: InboxContext,
  item: ClientAckItem,
): Promise<ActionResult> {
  const decoded = await ctx.transport.sendCookieProto(
    2010,
    item.inboxType ?? 0,
    '/v1/client/ack',
    {
      clientAck: {
        serverMessageId: LONG.fromString(item.serverMessageId),
        messageType: item.messageType ?? 500,
        status: item.status ?? 0,
        ...(item.clientMessageId
          ? { clientMessageId: LONG.fromString(item.clientMessageId) }
          : {}),
        ...(item.conversationShortId
          ? { conversationShortId: LONG.fromString(item.conversationShortId) }
          : {}),
        ...(item.count != null ? { count: item.count } : {}),
      },
    },
    ctx.deviceId,
  )
  return actionResponse(decoded)
}

export interface StrangerListOptions {
  /** 分页游标 */
  cursor?: number
  source?: number
  scene?: number
  inboxType?: number
}

/** cmd=1001 stranger/get_conversation_list:陌生人会话列表（实测服务端限流 409，错因在 statusMsg） */
export async function strangerConversations (
  ctx: InboxContext,
  req: StrangerListOptions = {},
): Promise<ActionResult> {
  const decoded = await ctx.transport.sendCookieProto(
    1001,
    req.inboxType ?? 0,
    '/v1/stranger/get_conversation_list',
    {
      strangerConversationList: {
        cursor: LONG.fromString(String(req.cursor ?? '0')),
        source: req.source ?? 1,
        scene: req.scene ?? 1,
      },
    },
    ctx.deviceId,
  )
  return actionResponse(decoded)
}

/* ---------------------------------------------------------------------------
 * vc-gate get_peer（JSON 明文通道，非 imapi proto）—— 按文件信息调度 CDN 传输节点
 * ------------------------------------------------------------------------- */

export interface GetPeerRequest {
  appId?: number
  sid?: number
  taskType?: number
  /** 原始键透传（vid/cdn_url/file_type/sfid 等），对齐服务端字段 */
  fileInfo: Record<string, unknown>
}

export interface GetPeerResult {
  status: number
  fid: string
  traceId: string
  reqId: string
  token: string
  nodes: unknown[]
  multiNodes?: unknown[] | null
  indexNum: number
  countryCode: number
  ispCode: number
}

/** vc-gate-edge get_peer:按文件信息调度 CDN 传输节点（Result 字段映射为 camelCase） */
export async function getPeer (
  http: Http,
  req: GetPeerRequest,
): Promise<GetPeerResult> {
  const res = await http.json<{
    Result?: {
      status?: number
      fid?: string
      trace_id?: string
      req_id?: string
      token?: string
      nodes?: unknown[]
      multi_nodes?: unknown[] | null
      index_num?: number
      country_code?: number
      isp_code?: number
    }
  }>('https://vc-gate-edge.ndcpp.com/sdk/get_peer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app_id: req.appId ?? 6383,
      sid: req.sid ?? 5,
      task_type: req.taskType ?? 1,
      file_info: req.fileInfo,
    }),
  })
  const result = res.data?.Result
  if (!result) throw new Error(`get_peer 无 Result: HTTP ${res.status}`)
  return {
    status: result.status ?? -1,
    fid: result.fid ?? '',
    traceId: result.trace_id ?? '',
    reqId: result.req_id ?? '',
    token: result.token ?? '',
    nodes: result.nodes ?? [],
    ...(result.multi_nodes != null ? { multiNodes: result.multi_nodes } : {}),
    indexNum: result.index_num ?? 0,
    countryCode: result.country_code ?? 0,
    ispCode: result.isp_code ?? 0,
  }
}