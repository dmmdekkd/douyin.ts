/**
 * Passport `mix_mode=1`：明文 UTF-8 逐字节 XOR 0x05，两位小写 hex 拼接。
 */
export function mixEncode (plain: string): string {
  const bytes = Buffer.from(plain, 'utf8')
  let out = ''
  for (let i = 0; i < bytes.length; i++) {
    out += ((bytes[i]! ^ 5).toString(16).padStart(2, '0'))
  }
  return out
}

/** 创作者抓包形态：`+86 ` + 11 位手机号（含空格） */
export function mixEncodeMobile (mobileDigits: string, countryCode = '86'): string {
  const digits = mobileDigits.replace(/\D/g, '')
  return mixEncode(`+${countryCode} ${digits}`)
}
