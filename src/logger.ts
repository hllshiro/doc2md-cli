import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdirSync, createWriteStream } from 'node:fs'
import { existsSync } from 'node:fs'

// 颜色代码
const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
}

const LEVEL_COLORS: Record<string, string> = {
  DEBUG: COLORS.dim,
  INFO: COLORS.green,
  WARN: COLORS.yellow,
  ERROR: COLORS.red,
}

type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'

class ProcessLogger {
  private static instance: ProcessLogger | null = null
  private logPath: string
  private fileStream: ReturnType<typeof createWriteStream>
  private isTTY: boolean

  private constructor() {
    // 生成带时间戳的日志文件名
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    this.logPath = join(tmpdir(), `doc2xml-cli-${timestamp}.log`)

    // 确保临时目录存在
    const tmpDir = tmpdir()
    if (!existsSync(tmpDir)) {
      mkdirSync(tmpDir, { recursive: true })
    }

    // 创建文件写入流
    this.fileStream = createWriteStream(this.logPath, { flags: 'a' })
    this.isTTY = process.stdout.isTTY

    // 写入日志头
    this.writeToFile('='.repeat(80))
    this.writeToFile(`doc2xml-cli 执行日志`)
    this.writeToFile(`开始时间: ${new Date().toLocaleString('zh-CN')}`)
    this.writeToFile(`日志文件: ${this.logPath}`)
    this.writeToFile('='.repeat(80))
    this.writeToFile('')
  }

  static getInstance(): ProcessLogger {
    if (!ProcessLogger.instance) {
      ProcessLogger.instance = new ProcessLogger()
    }
    return ProcessLogger.instance
  }

  static reset(): void {
    if (ProcessLogger.instance) {
      ProcessLogger.instance.fileStream.end()
    }
    ProcessLogger.instance = null
  }

  private writeToFile(line: string): void {
    this.fileStream.write(line + '\n')
  }

  private formatTime(): string {
    const now = new Date()
    return now.toLocaleTimeString('zh-CN', { hour12: false })
  }

  private formatTimeFull(): string {
    const now = new Date()
    return (
      now.toLocaleString('zh-CN', { hour12: false }) +
      '.' +
      String(now.getMilliseconds()).padStart(3, '0')
    )
  }

  private log(level: LogLevel, msg: string, task?: string): void {
    const taskPrefix = task ? `[${task}] ` : ''

    // 写入文件（完整格式，无颜色）
    const fileLine = `[${this.formatTimeFull()}] ${level}: ${taskPrefix}${msg}`
    this.writeToFile(fileLine)

    // 控制台输出（带颜色，仅 INFO 及以上）
    if (level !== 'DEBUG') {
      const color = LEVEL_COLORS[level] || COLORS.reset
      const consoleLine = `${COLORS.dim}[${this.formatTime()}]${COLORS.reset} ${color}${level.padEnd(5)}${COLORS.reset} ${COLORS.cyan}${taskPrefix}${COLORS.reset}${msg}`
      console.log(consoleLine)
    }
  }

  getLogPath(): string {
    return this.logPath
  }

  debug(msg: string, task?: string): void {
    this.log('DEBUG', msg, task)
  }

  info(msg: string, task?: string): void {
    this.log('INFO', msg, task)
  }

  warn(msg: string, task?: string): void {
    this.log('WARN', msg, task)
  }

  error(msg: string, task?: string): void {
    this.log('ERROR', msg, task)
  }
}

// 导出单例
export const logger = ProcessLogger.getInstance()

// 导出类（用于类型）
export { ProcessLogger }
