/**
 * 轻量日志:SDK 保持零依赖,输出通道收敛到 console;
 * 调用方可注入同形态实现替换(静默、落盘、上报等)。
 */

export interface Log {
  info(msg: string): void
  warn(msg: string): void
  error(msg: string): void
}

const GRAY = '\x1b[90m'
const CYAN = '\x1b[36m'
const YELLOW = '\x1b[33m'
const RED = '\x1b[31m'
const RESET = '\x1b[0m'

const pad = (n: number): string => String(n).padStart(2, '0')

function stamp(): string {
  const d = new Date()
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** quiet 用于调用方整体关停输出;tag 用于多实例区分来源 */
export function createLog(opts: { tag?: string; quiet?: boolean } = {}): Log {
  if (opts.quiet) return { info: () => {}, warn: () => {}, error: () => {} }
  const prefix = opts.tag ? ` ${GRAY}[${opts.tag}]${RESET}` : ''
  const line = (color: string, level: string, msg: string): string =>
    `${GRAY}${stamp()}${RESET}${prefix} ${color}${level}${RESET} ${msg}`
  return {
    info: msg => console.info(line(CYAN, 'info', msg)),
    warn: msg => console.warn(line(YELLOW, 'warn', msg)),
    error: msg => console.error(line(RED, 'error', msg)),
  }
}
