import { EDGE_ORIGIN, webGet, webPost } from './web.js'
import type { Http } from '../http/client.js'

/** 弹幕条目（danmaku/get_v2 单条，仅提取常用字段） */
export interface Danmaku {
  id: string
  itemId: string
  /** 发送者数字 uid */
  userId: string
  /** 出现时刻（毫秒偏移） */
  offsetTime: number
  text: string
  diggCount: number
  showDigg: boolean
}

/** danmaku/get_v2：拉取作品某时间段弹幕（start/end 为毫秒偏移窗口，webapp 批走 www-hj） */
export async function danmaku (
  http: Http,
  itemId: string,
  options: { groupId?: string; startTime?: number; endTime?: number; duration?: number; token?: string } = {},
): Promise<Danmaku[]> {
  const res = await webGet<{ danmaku_list?: unknown[] }>(
    http,
    '/aweme/v1/web/danmaku/get_v2/',
    {
      origin: EDGE_ORIGIN,
      params: {
        group_id: options.groupId ?? itemId,
        item_id: itemId,
        start_time: String(options.startTime ?? 0),
        end_time: String(options.endTime ?? 0),
        authentication_token: options.token ?? '',
        duration: String(options.duration ?? 0),
      },
    },
  )
  return (res.data.danmaku_list ?? []).map(danmakuOf)
}

/** play/progress：上报播放进度（服务端据此续播/记历史） */
export async function playProgress (
  http: Http,
  itemId: string,
  progress: number,
  duration: number,
): Promise<void> {
  const res = await webPost<{ status_code?: number }>(
    http,
    '/aweme/v1/web/play/progress/',
    { body: { item_duration: String(duration), item_id: itemId, item_progress: String(progress) } },
  )
  if (Number(res.data.status_code ?? -1) !== 0) throw new Error(`播放进度上报失败 (HTTP ${res.status})`)
}

/** series/watch/record：短剧剧集观看记录 */
export async function seriesRecord (
  http: Http,
  seriesId: string,
  itemId: string,
  episode: number,
): Promise<void> {
  const res = await webGet<{ status_code?: number }>(
    http,
    '/aweme/v1/web/series/watch/record/',
    { params: { episode: String(episode), series_id: seriesId, item_id: itemId } },
  )
  if (Number(res.data.status_code ?? -1) !== 0) throw new Error(`短剧观看记录失败 (HTTP ${res.status})`)
}

/** mix/watch/record：合集观看记录（webapp 批走 www-hj，scene 固定 pc_web） */
export async function mixRecord (
  http: Http,
  mixId: string,
  itemId: string,
  episode: number,
): Promise<void> {
  const res = await webGet<{ status_code?: number }>(
    http,
    '/aweme/v1/web/mix/watch/record/',
    {
      origin: EDGE_ORIGIN,
      params: { mix_id: mixId, episode: String(episode), item_id: itemId, scene: 'pc_web' },
    },
  )
  if (Number(res.data.status_code ?? -1) !== 0) throw new Error(`合集观看记录失败 (HTTP ${res.status})`)
}

/** history/write：写入观看历史（preItemId 缺省为空表示首次写入） */
export async function historyWrite (
  http: Http,
  awemeId: string,
  options: { authorId?: string; preItemId?: string } = {},
): Promise<void> {
  const res = await webPost<{ status_code?: number; BaseResp?: { StatusCode?: number } }>(
    http,
    '/aweme/v1/web/history/write/',
    {
      origin: EDGE_ORIGIN,
      body: {
        author_id: options.authorId ?? '',
        aweme_id: awemeId,
        pre_item_id: options.preItemId ?? '',
        pre_item_seen: '1',
      },
    },
  )
  const code = Number(res.data.status_code ?? res.data.BaseResp?.StatusCode ?? -1)
  if (code !== 0) throw new Error(`观看历史写入失败 (HTTP ${res.status})`)
}

/** safetyCheck：批量查作品安全等级（HAR 样本 result 为空；非空结构未实证，原样透传） */
export async function safetyCheck (
  http: Http,
  itemIds: string[],
): Promise<Array<Record<string, unknown>>> {
  const items = itemIds.map(itemId => ({
    item_id: itemId,
    dy_q: '',
    tag: 0,
    potential_risk_level: 0,
    authentication_token: '',
  }))
  const res = await webPost<{ status_code?: number; result?: Array<Record<string, unknown>> }>(
    http,
    '/aweme/v2/video/safety/check/',
    { body: { item_ids: JSON.stringify(items), potential_risk_level: '0', refer_string: 'recommend' } },
  )
  if (Number(res.data.status_code ?? -1) !== 0) throw new Error(`作品安全查询失败 (HTTP ${res.status})`)
  return res.data.result ?? []
}

function danmakuOf (raw: unknown): Danmaku {
  const r = raw as Record<string, unknown>
  return {
    id: String(r['danmaku_id'] ?? ''),
    itemId: String(r['item_id'] ?? ''),
    userId: String(r['user_id'] ?? ''),
    offsetTime: Number(r['offset_time'] ?? 0),
    text: typeof r['text'] === 'string' ? r['text'] : '',
    diggCount: Number(r['digg_count'] ?? 0),
    showDigg: r['show_digg'] === true,
  }
}
