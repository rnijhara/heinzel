// The Codex adapter: owns one `codex app-server` process and speaks its
// JSON-RPC protocol (ADR 3). It answers every request Codex sends back so a
// task never waits on a person (ADR 8).

import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { RpcError, RpcPeer, ErrorCodes } from '../shared/jsonrpc.ts'
import { VERSION } from '../shared/protocol.ts'
import type { InitializeResponse } from '../../protocol/codex/0.167.2/ts/index.ts'
import type {
  ConfigReadResponse,
  ModelListResponse,
  ThreadResumeResponse,
  ThreadStartParams,
  ThreadStartResponse,
  TurnStartParams,
  TurnStartResponse,
} from '../../protocol/codex/0.167.2/ts/v2/index.ts'

// How long a control request (thread/start, turn/start, ...) may take before
// the app-server is treated as hung and retired (ADR 4).
const CONTROL_TIMEOUT_MS = 60_000

export interface CodexOptions {
  argv: string[]
  env: NodeJS.ProcessEnv
  log: (line: string) => void
}

export function codexArgv(env: NodeJS.ProcessEnv): string[] {
  if (env.HEINZEL_CODEX_ARGV) {
    const argv = JSON.parse(env.HEINZEL_CODEX_ARGV)
    if (!Array.isArray(argv) || argv.length === 0) throw new Error('HEINZEL_CODEX_ARGV must be a JSON array')
    return argv
  }
  return ['codex', 'app-server']
}

// Answers for requests Codex sends to the client. Approvals normally go to
// Codex's own reviewer (`auto_review`); anything that still reaches us is
// declined, and every question for a person is declined at once.
export function answerServerRequest(method: string, _params: unknown): unknown {
  switch (method) {
    case 'item/commandExecution/requestApproval':
    case 'item/fileChange/requestApproval':
      return { decision: 'decline' }
    case 'execCommandApproval':
    case 'applyPatchApproval':
      return { decision: { denied: { rejection: 'Heinzel tasks run unattended; no one is available to approve this.' } } }
    case 'item/tool/requestUserInput':
      return { answers: {} }
    case 'mcpServer/elicitation/request':
      return { action: 'decline', content: null, _meta: null }
    default:
      throw new RpcError(ErrorCodes.MethodNotFound, `Heinzel does not handle ${method}`)
  }
}

export class CodexAppServer extends EventEmitter {
  private child: ChildProcess
  readonly peer: RpcPeer
  private log: (line: string) => void
  info: InitializeResponse | null = null
  exited = false

  private constructor(child: ChildProcess, log: (line: string) => void) {
    super()
    this.child = child
    this.log = log
    this.peer = new RpcPeer(child.stdout!, child.stdin!, {
      onNotification: (method, params) => this.emit('notification', method, params),
      onRequest: (method, params) => {
        this.log(`codex asked ${method}; answering for an unattended task`)
        this.emit('server-request', method, params)
        return answerServerRequest(method, params)
      },
    })
    child.stderr?.on('data', (b: Buffer) => {
      for (const line of b.toString().split('\n')) if (line.trim()) this.log(`codex stderr: ${line.slice(0, 500)}`)
    })
    child.on('exit', (code, signal) => this.onExit(`exited (code ${code}, signal ${signal})`))
    child.on('error', err => this.onExit(`failed to start: ${err.message}`))
    this.peer.on('close', () => this.onExit('closed its output'))
  }

  static async start(opts: CodexOptions): Promise<CodexAppServer> {
    const [cmd, ...args] = opts.argv
    opts.log(`starting ${opts.argv.join(' ')}`)
    const child = spawn(cmd!, args, { stdio: ['pipe', 'pipe', 'pipe'], env: opts.env })
    const server = new CodexAppServer(child, opts.log)
    try {
      server.info = await server.peer.request<InitializeResponse>('initialize', {
        clientInfo: { name: 'heinzel', title: 'Heinzel', version: VERSION },
        capabilities: { experimentalApi: false, requestAttestation: false },
      }, { timeoutMs: CONTROL_TIMEOUT_MS })
      server.peer.notify('initialized')
    } catch (err) {
      server.kill()
      throw new RpcError(ErrorCodes.Internal, `Could not start Codex: ${(err as Error).message}`)
    }
    return server
  }

  get version(): string {
    // userAgent looks like "codex_cli_rs/0.167.2 (...)" or "heinzel/0.167.2 ...".
    const m = this.info?.userAgent?.match(/\/(\d+\.\d+\.\d+[^\s]*)/)
    return m?.[1] ?? 'unknown'
  }

  private onExit(why: string) {
    if (this.exited) return
    this.exited = true
    this.log(`codex app-server ${why}`)
    this.emit('exit', why)
  }

  private async control<T>(method: string, params: unknown): Promise<T> {
    try {
      return await this.peer.request<T>(method, params, { timeoutMs: CONTROL_TIMEOUT_MS })
    } catch (err) {
      if (err instanceof RpcError && err.code === ErrorCodes.Timeout) {
        this.log(`${method} timed out; retiring the app-server`)
        this.kill()
      }
      throw err
    }
  }

  threadStart(params: ThreadStartParams) {
    return this.control<ThreadStartResponse>('thread/start', params)
  }

  threadResume(threadId: string, overrides: Partial<ThreadStartParams> = {}) {
    return this.control<ThreadResumeResponse>('thread/resume', { threadId, ...overrides })
  }

  turnStart(params: TurnStartParams) {
    return this.control<TurnStartResponse>('turn/start', params)
  }

  turnInterrupt(threadId: string, turnId: string) {
    return this.control<Record<string, never>>('turn/interrupt', { threadId, turnId })
  }

  async modelList() {
    const all: ModelListResponse['data'] = []
    let cursor: string | null = null
    for (let page = 0; page < 20; page++) {
      const res: ModelListResponse = await this.control<ModelListResponse>('model/list', cursor ? { cursor } : {})
      all.push(...res.data)
      if (!res.nextCursor) break
      cursor = res.nextCursor
    }
    return all
  }

  configRead(cwd?: string) {
    return this.control<ConfigReadResponse>('config/read', cwd ? { cwd } : {})
  }

  kill() {
    if (!this.child.killed) this.child.kill('SIGTERM')
    setTimeout(() => { if (!this.exited) this.child.kill('SIGKILL') }, 3000).unref()
  }

  // Stops the process and resolves once it has exited (SIGKILL after 3 s).
  stop(): Promise<void> {
    if (this.exited || this.child.exitCode !== null || this.child.signalCode !== null) return Promise.resolve()
    const gone = new Promise<void>(resolve => this.child.once('exit', () => resolve()))
    this.kill()
    return gone
  }
}
