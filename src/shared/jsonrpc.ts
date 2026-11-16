// Newline-delimited JSON-RPC 2.0 over a pair of streams. Used for the helper's
// connection to `codex app-server` (stdio) and for relay <-> helper (socket).

import { EventEmitter } from 'node:events'
import { createInterface } from 'node:readline'
import type { Readable, Writable } from 'node:stream'

export type Id = number | string

export class RpcError extends Error {
  code: number
  data?: unknown
  constructor(code: number, message: string, data?: unknown) {
    super(message)
    this.name = 'RpcError'
    this.code = code
    this.data = data
  }
}

export const ErrorCodes = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  Internal: -32603,
  Closed: -32000,
  Timeout: -32001,
} as const

export interface RpcHandlers {
  onRequest?: (method: string, params: any, id: Id) => Promise<unknown> | unknown
  onNotification?: (method: string, params: any) => void
}

interface Pending {
  resolve: (v: any) => void
  reject: (e: Error) => void
  timer?: NodeJS.Timeout
  method: string
}

export interface RequestOptions {
  timeoutMs?: number
  signal?: AbortSignal
}

export class RpcPeer extends EventEmitter {
  private nextId = 1
  private pending = new Map<Id, Pending>()
  private closed = false
  private output: Writable
  handlers: RpcHandlers
  // Optional hook to see every line in and out (for logging and tests).
  trace?: (dir: 'in' | 'out', msg: unknown) => void

  constructor(input: Readable, output: Writable, handlers: RpcHandlers = {}) {
    super()
    this.output = output
    this.handlers = handlers
    const rl = createInterface({ input, crlfDelay: Infinity })
    rl.on('line', line => this.onLine(line))
    rl.on('close', () => this.shutdown(new RpcError(ErrorCodes.Closed, 'connection closed')))
    output.on('error', err => this.shutdown(err))
  }

  get isClosed() {
    return this.closed
  }

  request<T = any>(method: string, params?: unknown, opts: RequestOptions = {}): Promise<T> {
    if (this.closed) return Promise.reject(new RpcError(ErrorCodes.Closed, 'connection closed'))
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      const p: Pending = { resolve, reject, method }
      if (opts.timeoutMs) {
        p.timer = setTimeout(() => {
          this.pending.delete(id)
          reject(new RpcError(ErrorCodes.Timeout, `${method} timed out after ${opts.timeoutMs} ms`))
        }, opts.timeoutMs)
      }
      if (opts.signal) {
        if (opts.signal.aborted) return reject(new RpcError(ErrorCodes.Closed, 'aborted'))
        opts.signal.addEventListener('abort', () => {
          if (this.pending.delete(id)) {
            clearTimeout(p.timer)
            reject(new RpcError(ErrorCodes.Closed, 'aborted'))
          }
        }, { once: true })
      }
      this.pending.set(id, p)
      this.write({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) })
    })
  }

  notify(method: string, params?: unknown) {
    if (this.closed) return
    this.write({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) })
  }

  close() {
    this.shutdown(new RpcError(ErrorCodes.Closed, 'connection closed'))
    this.output.end()
  }

  private write(msg: unknown) {
    this.trace?.('out', msg)
    try {
      this.output.write(JSON.stringify(msg) + '\n')
    } catch (err) {
      this.shutdown(err as Error)
    }
  }

  private shutdown(err: Error) {
    if (this.closed) return
    this.closed = true
    for (const [, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(err)
    }
    this.pending.clear()
    this.emit('close', err)
  }

  private onLine(line: string) {
    if (!line.trim()) return
    let msg: any
    try {
      msg = JSON.parse(line)
    } catch {
      this.emit('parse-error', line)
      return
    }
    this.trace?.('in', msg)
    if (msg.id !== undefined && msg.method === undefined) {
      const p = this.pending.get(msg.id)
      if (!p) return
      this.pending.delete(msg.id)
      clearTimeout(p.timer)
      if (msg.error) p.reject(new RpcError(msg.error.code ?? ErrorCodes.Internal, msg.error.message ?? 'error', msg.error.data))
      else p.resolve(msg.result)
      return
    }
    if (msg.method !== undefined && msg.id !== undefined) {
      void this.answer(msg.id, msg.method, msg.params)
      return
    }
    if (msg.method !== undefined) {
      try {
        this.handlers.onNotification?.(msg.method, msg.params)
      } catch (err) {
        this.emit('handler-error', err)
      }
    }
  }

  private async answer(id: Id, method: string, params: unknown) {
    if (!this.handlers.onRequest) {
      this.write({ jsonrpc: '2.0', id, error: { code: ErrorCodes.MethodNotFound, message: `unknown method ${method}` } })
      return
    }
    try {
      const result = await this.handlers.onRequest(method, params, id)
      this.write({ jsonrpc: '2.0', id, result: result ?? {} })
    } catch (err: any) {
      const code = err instanceof RpcError ? err.code : ErrorCodes.Internal
      this.write({ jsonrpc: '2.0', id, error: { code, message: err?.message ?? String(err), ...(err?.data !== undefined ? { data: err.data } : {}) } })
    }
  }
}
