import { readFileSync } from 'node:fs'

const har = JSON.parse(readFileSync('C:/Users/momo/Downloads/imapi.douyin.com_2026_09_29_05_30_38.har', 'utf8'))
const hit = har.log.entries.find(e => {
  const u = new URL(e.request.url)
  return u.host === 'imapi.douyin.com' && u.pathname === '/v1/message/send' && e.request.method === 'POST'
})
const buf = Buffer.from(hit.request.postData.text, 'base64')
console.log('字节数:', buf.length)

function decode (bytes, depth = 0) {
  const fields = []
  let off = 0
  let readVarint = () => {
    let val = 0n, shift = 0n
    while (off < bytes.length) {
      const b = bytes[off++]
      val |= BigInt(b & 0x7f) << shift
      if ((b & 0x80) === 0) return val
      shift += 7n
    }
    return val
  }
  while (off < bytes.length) {
    const tag = readVarint()
    const field = Number(tag >> 3n)
    const wire = Number(tag & 7n)
    if (wire === 0) { fields.push({ f: field, t: 'varint', v: readVarint().toString() }) }
    else if (wire === 1) { const v = bytes.readBigUInt64LE(off); off += 8; fields.push({ f: field, t: 'fixed64', v: '0x' + v.toString(16) }) }
    else if (wire === 5) { const v = bytes.readUInt32LE(off); off += 4; fields.push({ f: field, t: 'fixed32', v: v.toString() }) }
    else if (wire === 3) {
      // group:读到 wire4
      const sub = []
      while (off < bytes.length) {
        const t2 = readVarint()
        const f2 = Number(t2 >> 3n)
        const w2 = Number(t2 & 7n)
        if (w2 === 4) break
        off = decodeField(sub, bytes, off, f2, w2, depth + 1)
      }
      fields.push({ f: field, t: 'message', v: sub })
    }
    else if (wire === 4) { /* group end */ }
    else if (wire === 2) {
      const len = Number(readVarint())
      if (len < 0 || len > bytes.length - off) { break }
      const sub = bytes.subarray(off, off + len)
      off += len
      const text = sub.toString('utf8')
      const printable = /^[\x20-\x7e\n\r\t]*$/.test(text)
      if (sub.length > 4 && printable && depth < 8) fields.push({ f: field, t: 'string', v: text })
      else if (depth < 8) fields.push({ f: field, t: 'message', v: decode(sub, depth + 1) })
      else fields.push({ f: field, t: 'bytes', v: `#${sub.length}` })
    }
    else { /* 未知 wire:跳过 1 字节 */ off-- }
    if (off <= 0) break
  }
  return fields
}

function decodeField (out, bytes, pos, field, wire, depth) {
  const readVarintAt = () => {
    let val = 0n, shift = 0n
    while (pos < bytes.length) {
      const b = bytes[pos++]
      val |= BigInt(b & 0x7f) << shift
      if ((b & 0x80) === 0) break
      shift += 7n
    }
    return val
  }
  if (wire === 0) { out.push({ f: field, t: 'varint', v: readVarintAt().toString() }) }
  else if (wire === 2) {
    const len = Number(readVarintAt())
    const sub = bytes.subarray(pos, pos + len)
    pos += len
    const text = sub.toString('utf8')
    const printable = /^[\x20-\x7e\n\r\t]*$/.test(text)
    if (sub.length > 4 && printable && depth < 8) out.push({ f: field, t: 'string', v: text })
    else if (depth < 8) out.push({ f: field, t: 'message', v: decode(sub, depth + 1) })
    else out.push({ f: field, t: 'bytes', v: `#${sub.length}` })
  }
  return pos
}

const tree = decode(buf)

// 压缩显示:string 截断
function show (arr, indent = '') {
  for (const f of arr) {
    if (f.t === 'string') {
      const v = f.v.length > 400 ? f.v.slice(0, 400) + `…(${f.v.length})` : f.v
      console.log(`${indent}f${f.f} string: ${v}`)
    } else if (f.t === 'message') {
      console.log(`${indent}f${f.f} message:`)
      show(f.v, indent + '  ')
    } else if (f.t === 'bytes') {
      console.log(`${indent}f${f.f} bytes ${f.v}`)
    } else {
      console.log(`${indent}f${f.f} ${f.t}: ${f.v}`)
    }
  }
}
show(tree)