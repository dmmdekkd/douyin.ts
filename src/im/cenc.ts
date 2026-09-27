import { decryptCencSample } from './media.js'
import type { CencSubsample } from './media.js'

/* ---------------------------------------------------------------------------
 * CENC(cenc 方案) 加密 mp4 解密：私信视频 mainUrl 下载后为 encv/enca+tenc 容器，
 * 用消息 video.skey(16B AES-128) 逐样本 AES-CTR 子样本解密并去保护重组，
 * 输出可直接播放的 mp4。容器逆推自抖音实测样本（moov 在尾、senc 携带辅助数据）。
 * ------------------------------------------------------------------------- */

/** mp4 box 树节点（容器含子节点；stsd 的 sample entry 子 box 需扫描定位） */
interface Box {
  type: string
  start: number
  body: number
  end: number
  children?: Box[]
}

/** 纯容器 box（body 全部为子 box） */
const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'sinf', 'schi'])

/** 每样本解密辅助信息 */
interface SampleAux {
  iv: Buffer
  subsamples: CencSubsample[]
}

function fourcc (buf: Buffer, off: number): string {
  return buf.toString('latin1', off, off + 4)
}

function parseBoxes (buf: Buffer, start: number, end: number, stsd = false): Box[] {
  const list: Box[] = []
  let off = start
  while (off + 8 <= end) {
    let size = buf.readUInt32BE(off)
    let hdr = 8
    // largesize box：size=1 时真实长度在 8 字节扩展字段（抖音的 encv/enca sample entry 即此形态）
    if (size === 1) {
      if (off + 16 > end) break
      size = Number(buf.readBigUInt64BE(off + 8))
      hdr = 16
    } else if (size === 0) {
      size = end - off
    }
    if (size < hdr || off + size > end) break
    const type = fourcc(buf, off + 4)
    const body = off + hdr
    const node: Box = { type, start: off, body, end: off + size }
    if (type === 'stsd') {
      node.children = parseBoxes(buf, body + 8, node.end, true)
    } else if (stsd || type === 'encv' || type === 'enca') {
      node.children = parseBoxes(buf, entryChildStart(buf, body, node.end), node.end)
    } else if (CONTAINERS.has(type)) {
      node.children = parseBoxes(buf, body, node.end)
    }
    list.push(node)
    off += size
  }
  return list
}

function find (boxes: Box[], type: string): Box | undefined {
  return boxes.find(node => node.type === type)
}

/** sample entry 固定字段（encv=78/enca=28 等）之后的子 box 起点：滑窗找首个合法 box */
function entryChildStart (buf: Buffer, body: number, end: number): number {
  for (let off = body + 8; off + 8 <= end; off++) {
    const size = buf.readUInt32BE(off)
    if (size < 8 || off + size > end) continue
    if (/^[\x20-\x7e]{4}$/.test(fourcc(buf, off + 4))) return off
  }
  return end
}

/** 解析 tenc：KID 固定占 box 尾 16 字节（抖音将其设为解密 key），IV_size 在其前 1 字节 */
function parseTenc (tenc: Box, buf: Buffer): { ivSize: number } {
  const len = tenc.end - tenc.body
  return { ivSize: buf[tenc.body + len - 17] }
}

/** senc box → 每样本 IV/子样本序列（抖音样本的辅助数据源；saiz/saio 为同内容的偏移定位变体，仅 senc 缺失时兜底） */
function parseAux (buf: Buffer, senc: Box | undefined, saiz: Box | undefined, saio: Box | undefined, count: number, ivSize: number): SampleAux[] {
  const auxs: SampleAux[] = []
  if (senc) {
    // 抖音视频轨 flags=2 也携带子样本，仅音频纯 IV 流 flags=0
    const withSub = (buf.readUInt32BE(senc.body) & 0xffffff) !== 0
    let off = senc.body + 8
    for (let i = 0; i < count; i++) {
      const iv = Buffer.from(buf.subarray(off, off + ivSize))
      off += ivSize
      const subsamples: CencSubsample[] = []
      if (withSub) {
        const n = buf.readUInt16BE(off)
        off += 2
        for (let k = 0; k < n; k++) {
          subsamples.push({ clear: buf.readUInt16BE(off), protected: buf.readUInt32BE(off + 2) })
          off += 6
        }
      }
      auxs.push({ iv, subsamples })
    }
    return auxs
  }
  if (saiz && saio && ivSize > 0) {
    const flags = buf[saiz.body + 7]
    const def = buf[saiz.body + 12]
    const sizeOf = (k: number): number => (flags & 1 ? buf[saiz.body + 17 + k] : def)
    let aux = saio.body + 4
    if ((buf.readUInt32BE(saio.body) & 0xffffff & 1) === 1) aux += 8
    const auxBase = buf[saio.body] === 1 ? Number(buf.readBigUInt64BE(aux + 4)) : buf.readUInt32BE(aux + 4)
    let at = auxBase
    for (let i = 0; i < count; i++) {
      const iv = Buffer.from(buf.subarray(at, at + ivSize))
      const subsamples: CencSubsample[] = []
      let pos = at + ivSize
      if (sizeOf(i) > ivSize) {
        const n = buf.readUInt16BE(pos)
        pos += 2
        for (let k = 0; k < n; k++) {
          subsamples.push({ clear: buf.readUInt16BE(pos), protected: buf.readUInt32BE(pos + 2) })
          pos += 6
        }
      }
      at += sizeOf(i)
      auxs.push({ iv, subsamples })
    }
    return auxs
  }
  return auxs
}

interface TrackPlan {
  stbl: Box
  entry: Box
  rawFourcc: string
  samples: { offset: number; size: number }[]
  auxs: SampleAux[]
}

/** 从 stbl 组装解密计划：样本定位（stsz/stsc/stco）+ 每样本 IV/子样本（senc 或 saiz/saio 或 constant_iv） */
function planTrack (buf: Buffer, stbl: Box, entry: Box): TrackPlan {
  const sinf = find(entry.children ?? [], 'sinf')
  const frma = find(sinf?.children ?? [], 'frma')
  const tenc = find(find(sinf?.children ?? [], 'schi')?.children ?? [], 'tenc')
  if (!sinf || !frma || !tenc) throw new Error('mp4 缺少 CENC 保护结构（sinf/frma/tenc）')
  const { ivSize } = parseTenc(tenc, buf)
  if (ivSize !== 8 && ivSize !== 16) throw new Error(`tenc IV 尺寸异常: ${ivSize}`)

  const stsz = find(stbl.children!, 'stsz')
  const stsc = find(stbl.children!, 'stsc')
  const stco = find(stbl.children!, 'stco') ?? find(stbl.children!, 'co64')
  if (!stsz || !stco || !stsc) throw new Error('mp4 缺少样本表（stsz/stsc/stco）')

  const b = stsz.body
  const uniform = buf.readUInt32BE(b + 4)
  const count = buf.readUInt32BE(b + 8)
  const sizes: number[] = []
  for (let i = 0; i < count; i++) sizes.push(uniform > 0 ? uniform : buf.readUInt32BE(b + 12 + i * 4))

  // stsc → 每 chunk 样本数序列；stco → chunk 绝对偏移；展开全部样本位置
  const chunkCounts: number[] = []
  {
    const n = buf.readUInt32BE(stsc.body + 4)
    const chunks = buf.readUInt32BE(stco.body + 4)
    for (let i = 0; i < n; i++) {
      const base = stsc.body + 8 + i * 12
      const first = buf.readUInt32BE(base)
      const per = buf.readUInt32BE(base + 4)
      const span = (i + 1 < n ? buf.readUInt32BE(stsc.body + 8 + (i + 1) * 12) : chunks + 1) - first
      for (let j = 0; j < span; j++) chunkCounts.push(per)
    }
  }
  const samples: { offset: number; size: number }[] = []
  {
    let index = 0
    for (let c = 0; c < chunkCounts.length && index < count; c++) {
      const base = stco.type === 'co64' ? stco.body + 8 + c * 8 : stco.body + 8 + c * 4
      const offset = stco.type === 'co64' ? Number(buf.readBigUInt64BE(base)) : buf.readUInt32BE(base)
      let acc = 0
      for (let j = 0; j < chunkCounts[c] && index < count; j++) {
        samples.push({ offset: offset + acc, size: sizes[index] })
        acc += sizes[index]
        index++
      }
    }
  }

  const auxs = parseAux(buf, find(stbl.children!, 'senc'), find(stbl.children!, 'saiz'), find(stbl.children!, 'saio'), count, ivSize)
  if (auxs.length !== count) throw new Error(`辅助信息样本数不匹配（${auxs.length}/${count}）`)
  return { stbl, entry, rawFourcc: fourcc(buf, frma.body), samples, auxs }
}

/**
 * 解密 CENC(cenc 方案) 加密 mp4：keyHex 为消息 `video.skey`（32 hex = 16 字节 AES-128）。
 * 输出可直接播放的 mp4；未加密的输入原样返回。
 */
export function decryptCencMp4 (data: Uint8Array, keyHex: string): Buffer {
  const key = Buffer.from(keyHex, 'hex')
  if (key.length !== 16) throw new Error('视频 skey 必须是 32 hex 字符（16 字节 AES-128）')
  const buf = Buffer.from(data)
  const top = parseBoxes(buf, 0, buf.length)
  const moov = find(top, 'moov')
  const mdat = find(top, 'mdat')
  if (!moov) throw new Error('mp4 缺少 moov')
  if (!mdat) throw new Error('mp4 缺少 mdat')

  // 逐加密轨原位解密 mdat 样本
  const plans: TrackPlan[] = []
  for (const trak of moov.children!.filter(node => node.type === 'trak')) {
    const minf = find(find(trak.children!, 'mdia')?.children ?? [], 'minf')
    const stbl = find(minf?.children ?? [], 'stbl')
    const stsd = stbl && find(stbl.children!, 'stsd')
    const entry = stsd?.children?.[0]
    if (!stbl || !entry || (entry.type !== 'encv' && entry.type !== 'enca')) continue
    plans.push(planTrack(buf, stbl, entry))
  }
  if (plans.length === 0) return buf
  for (const plan of plans) {
    plan.samples.forEach((sample, i) => {
      const { iv, subsamples } = plan.auxs[i]
      const plain = decryptCencSample(buf.subarray(sample.offset, sample.offset + sample.size), key, iv, subsamples)
      plain.copy(buf, sample.offset)
    })
  }

  // 重建输出：sample entry 改回原始 fourcc，删除保护结构（sinf/senc/saiz/saio/sgpd/sbgp 的 seig 项）
  const deleted = new Set<Box>()
  const renamed = new Map<Box, string>()
  for (const plan of plans) {
    renamed.set(plan.entry, plan.rawFourcc)
    const sinf = find(plan.entry.children ?? [], 'sinf')
    if (sinf) deleted.add(sinf)
    for (const node of plan.stbl.children!) {
      if (node.type === 'senc' || node.type === 'saiz' || node.type === 'saio') deleted.add(node)
      if ((node.type === 'sgpd' || node.type === 'sbgp') && fourcc(buf, node.body + 4) === 'seig') deleted.add(node)
    }
  }

  const sizes = new Map<Box, number>()
  const compute = (node: Box): number => {
    if (deleted.has(node)) return 0
    if (!node.children) {
      sizes.set(node, node.end - node.start)
      return node.end - node.start
    }
    const prefix = node.type === 'stsd' ? node.body + 8 : renamed.has(node) ? entryChildStart(buf, node.body, node.end) : node.body
    let total = prefix - node.start
    for (const child of node.children) total += compute(child)
    sizes.set(node, total)
    return total
  }
  for (const node of top) compute(node)

  // moov 在 mdat 之前时删除会使 mdat 绝对偏移前移，需修正 stco/co64
  const shrink = moov.end - moov.start - (sizes.get(moov) ?? 0)
  if (moov.end <= mdat.start && shrink > 0) {
    for (const plan of plans) {
      const stco = find(plan.stbl.children!, 'stco') ?? find(plan.stbl.children!, 'co64')
      if (!stco) continue
      const n = buf.readUInt32BE(stco.body + 4)
      for (let i = 0; i < n; i++) {
        if (stco.type === 'co64') {
          const at = stco.body + 8 + i * 8
          buf.writeBigUInt64BE(buf.readBigUInt64BE(at) + BigInt(shrink), at)
        } else {
          const at = stco.body + 8 + i * 4
          buf.writeUInt32BE(buf.readUInt32BE(at) + shrink, at)
        }
      }
    }
  }

  const total = top.reduce((sum, node) => sum + (sizes.get(node) ?? 0), 0)
  const out = Buffer.alloc(total)
  let pos = 0
  const emit = (node: Box): void => {
    if (deleted.has(node)) return
    out.writeUInt32BE(sizes.get(node)!, pos)
    out.write(renamed.get(node) ?? node.type, pos + 4, 'latin1')
    pos += 8
    if (!node.children) {
      buf.copy(out, pos, node.body, node.end)
      pos += node.end - node.body
      return
    }
    const prefixEnd = node.type === 'stsd' ? node.body + 8 : renamed.has(node) ? entryChildStart(buf, node.body, node.end) : node.body
    buf.copy(out, pos, node.body, prefixEnd)
    pos += prefixEnd - node.body
    for (const child of node.children) emit(child)
  }
  for (const node of top) emit(node)
  return out
}
