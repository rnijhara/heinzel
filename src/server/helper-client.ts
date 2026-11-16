// The relay's connection to the shared helper: connects, starts the helper
// when none is running, and handles the version handshake (ADR 4).

import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { connect } from 'node:net'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { RpcPeer, RpcError, ErrorCodes, type RequestOptions } from '../shared/jsonrpc.ts'
import type { Paths } from '../shared/paths.ts'
import { HELPER_PROTOCOL, VERSION, type HelloResult } from '../shared/protocol.ts'

const CONNECT_TIMEOUT_MS = 10_000

export function helperEntry(env: NodeJS.ProcessEnv): string {
  if (env.HEINZEL_HELPER_ENTRY) return env.HEINZEL_HELPER_ENTRY
  const here = import.meta.url
  return fileURLToPath(new URL(here.endsWith('.ts') ? '../helper/cli.ts' : './helper.mjs', here))
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function tryConnect(socketPath: string): Promise<RpcPeer | null> {
  return new Promise(resolve => {
    if (!existsSync(socketPath)) return resolve(null)
    const socket = connect(socketPath)
    socket.once('connect', () => resolve(new RpcPeer(socket, socket)))
    socket.once('error', () => resolve(null))
  })
}

export class HelperClient extends EventEmitter {
  private paths: Paths
  private env: NodeJS.ProcessEnv
  readonly sessionId: string
  private peer: RpcPeer | null = null
  private connecting: Promise<RpcPeer> | null = null
  hello: HelloResult | null = null
  log: (line: string) => void

  constructor(paths: Paths, env: NodeJS.ProcessEnv, sessionId: string, log: (line: string) => void = () => {}) {
    super()
    this.paths = paths
    this.env = env
    this.sessionId = sessionId
    this.log = log
  }

  async call<T = any>(method: string, params?: unknown, opts?: RequestOptions): Promise<T> {
    const peer = await this.ensure()
    return peer.request<T>(method, params, opts)
  }

  close() {
    this.peer?.close()
  }

  private ensure(): Promise<RpcPeer> {
    if (this.peer && !this.peer.isClosed) return Promise.resolve(this.peer)
    if (!this.connecting) {
      this.connecting = this.connect().finally(() => { this.connecting = null })
    }
    return this.connecting
  }

  private spawnHelper() {
    const entry = helperEntry(this.env)
    this.log(`starting helper ${entry}`)
    // A stable working directory, so the helper never holds a session's folder.
    const child = spawn(process.execPath, [entry], { detached: true, stdio: 'ignore', env: this.env, cwd: homedir() })
    child.unref()
  }

  private async connect(): Promise<RpcPeer> {
    let spawned = false
    let restarted = false
    const deadline = Date.now() + CONNECT_TIMEOUT_MS
    while (Date.now() < deadline) {
      const peer = await tryConnect(this.paths.socket)
      if (!peer) {
        if (!spawned) {
          this.spawnHelper()
          spawned = true
        }
        await sleep(100)
        continue
      }
      peer.handlers.onNotification = (method, params) => this.emit(method, params)
      let hello: HelloResult
      try {
        hello = await peer.request<HelloResult>('hello', { version: VERSION, protocol: HELPER_PROTOCOL, sessionId: this.sessionId, pid: process.pid }, { timeoutMs: 5000 })
      } catch {
        peer.close()
        await sleep(100)
        continue
      }
      if (hello.version !== VERSION && !restarted) {
        // A different helper version is running. Restart it if it's idle;
        // otherwise keep using it while the protocol matches (ADR 4).
        const res = await peer.request<{ stopping: boolean }>('shutdown', { reason: `relay ${VERSION} replaces helper ${hello.version}` }).catch(() => ({ stopping: false }))
        if (res.stopping) {
          this.log(`asked helper ${hello.version} to restart for ${VERSION}`)
          peer.close()
          restarted = true
          await this.waitForSocketGone()
          continue
        }
      }
      if (hello.protocol !== HELPER_PROTOCOL) {
        peer.close()
        throw new RpcError(ErrorCodes.Internal, `The running Heinzel helper (${hello.version}) is busy with tasks and speaks an older protocol. Try again once its tasks finish.`)
      }
      this.hello = hello
      this.peer = peer
      peer.on('close', () => {
        if (this.peer === peer) this.peer = null
        this.emit('disconnected')
      })
      return peer
    }
    throw new RpcError(ErrorCodes.Internal, `Couldn't reach the Heinzel helper at ${this.paths.socket}. Its log is ${this.paths.log}.`)
  }

  private async waitForSocketGone() {
    for (let i = 0; i < 50 && existsSync(this.paths.socket); i++) await sleep(100)
  }
}
