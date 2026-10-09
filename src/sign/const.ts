/** Passport 域常量：passport = 登录链路（imdesktop 桌面端内嵌登录页），im = 桌面 IM 链路（imdesktop），web = 创作者网页链路（creator.douyin.com） */

/**
 * 桌面客户端内嵌登录页链路（imdesktop.douyin.com 实证）：
 * 登录与 IM 同域同 aid，扫码产出 aid=339757 会话，直接用于 IM 数据域
 */
export const passport = {
  origin: 'https://imdesktop.douyin.com',
  aid: '339757',
  appKey: '3c452fb664e3de0e936108429a0bc697',
  // 桌面客户端 Windows 内嵌登录页 UA（HAR 实证）；确认轮风控评估 UA 与环境一致性，通用浏览器 UA 会触发 2156
  ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) douyinim/1.1.34 Chrome/136.0.7103.59 Electron/36.4.0-rs.28.release.main.0 TTElectron/36.4.0-rs.28.release.main.0 Safari/537.36',
} as const

export const im = {
  origin: 'https://imdesktop.douyin.com',
  aid: '339757',
  version: '1.1.34',
  appKey: '3c452fb664e3de0e936108429a0bc697',
} as const

export const web = {
  origin: 'https://creator.douyin.com',
  aid: '2906',
  appKey: '6ddd3ec693f3a124adb29b91b244ece5',
} as const

export const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36'
