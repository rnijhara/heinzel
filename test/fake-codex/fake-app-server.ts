// A fake `codex app-server` for tests (ADR 16). It speaks the same
// newline-delimited JSON-RPC over stdio, and validates every message it sends
// against the checked-in Codex schema, so it can't drift from real Codex.
//
// The brief (or follow-up) text drives what a turn does:
//   [slow:N]     take N ms, emitting a message every 100 ms (interruptible)
//   [fail]       end the turn as failed
//   [crash]      exit the process mid-turn
//   [approval]   send a command approval request and report the answer
//   [ask]        send a user-input request and an elicitation, report answers
//   [write:F]    create file F in the thread's cwd
//   [silent]     finish without a final message
// FAKE_CODEX_LOG, when set, receives every line in and out.

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import Ajv from 'ajv'

const SCHEMA = fileURLToPath(new URL('../../protocol/codex/0.167.2/schema/', import.meta.url))
const ajv = new Ajv({ strict: false, allErrors: false, validateFormats: false })
const load = (f: string) => JSON.parse(readFileSync(join(SCHEMA, f), 'utf8'))
const validators = {
  notification: ajv.compile(load('ServerNotification.json')),
  request: ajv.compile(load('ServerRequest.json')),
  initialize: ajv.compile(load('v1/InitializeResponse.json')),
  'thread/start': ajv.compile(load('v2/ThreadStartResponse.json')),
  'thread/resume': ajv.compile(load('v2/ThreadResumeResponse.json')),
  'turn/start': ajv.compile(load('v2/TurnStartResponse.json')),
  'turn/interrupt': ajv.compile(load('v2/TurnInterruptResponse.json')),
  'model/list': ajv.compile(load('v2/ModelListResponse.json')),
  'config/read': ajv.compile(load('v2/ConfigReadResponse.json')),
} as Record<string, ReturnType<typeof ajv.compile>>

const LOG = process.env.FAKE_CODEX_LOG
const trace = (dir: string, m: unknown) => { if (LOG) appendFileSync(LOG, `${dir} ${JSON.stringify(m)}\n`) }

function check(kind: string, value: unknown) {
  const v = validators[kind]
  if (v && !v(value)) {
    process.stderr.write(`FAKE CODEX SCHEMA VIOLATION (${kind}): ${ajv.errorsText(v.errors)}\n${JSON.stringify(value).slice(0, 2000)}\n`)
    process.exit(3)
  }
}

const out = (m: Record<string, unknown>) => {
  trace('>>', m)
  process.stdout.write(JSON.stringify(m) + '\n')
}
const respond = (id: number, method: string, result: unknown) => {
  check(method, result)
  out({ id, result })
}
const notify = (method: string, params: unknown) => {
  check('notification', { method, params })
  out({ method, params })
}
let nextServerId = 1000
const serverRequests = new Map<number, (result: any) => void>()
const ask = (method: string, params: unknown) => new Promise<any>(resolve => {
  check('request', { id: nextServerId, method, params })
  const id = nextServerId++
  serverRequests.set(id, resolve)
  out({ id, method, params })
})

const now = () => Math.floor(Date.now() / 1000)
const uuid = () => crypto.randomUUID()
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

const MODELS = [
  { id: 'fake-big', efforts: ['low', 'medium', 'high'], def: 'medium', isDefault: true },
  { id: 'fake-small', efforts: ['low', 'medium'], def: 'low', isDefault: false },
]

interface Thread { id: string; cwd: string; model: string; turns: number; active: { id: string; interrupted: boolean } | null }
const threads = new Map<string, Thread>()

function threadObject(t: Thread) {
  return {
    id: t.id, sessionId: t.id, forkedFromId: null, parentThreadId: null, preview: '', ephemeral: false,
    modelProvider: 'openai', createdAt: now(), updatedAt: now(), recencyAt: now(), status: { type: 'idle' },
    path: null, cwd: t.cwd, cliVersion: '0.167.2', source: 'appServer', threadSource: null, agentNickname: null,
    agentRole: null, gitInfo: null, name: null, turns: [], environments: [], extra: null, section: null,
    sectionEnteredAt: null, projectId: null, historyMode: 'paginated', model: t.model, reasoningEffort: 'medium',
  }
}

function startResponse(t: Thread) {
  return {
    thread: threadObject(t), model: t.model, modelProvider: 'openai', serviceTier: null, disabledPluginIds: [],
    cwd: t.cwd, instructionSources: [], approvalPolicy: 'on-request', approvalsReviewer: 'auto_review',
    sandbox: { type: 'workspaceWrite', writableRoots: [], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false },
    reasoningEffort: 'medium',
  }
}

function turnObject(id: string, status: string, items: unknown[] = [], error: unknown = null) {
  return { id, rootTurnId: id, items, itemsView: items.length ? 'summary' : 'notLoaded', status, error, startedAt: now(), completedAt: status === 'inProgress' ? null : now(), durationMs: status === 'inProgress' ? null : 1 }
}

function item(threadId: string, turnId: string, it: Record<string, unknown>) {
  notify('item/started', { item: { ...it, startedAtMs: Date.now(), completedAtMs: null }, threadId, turnId, startedAtMs: Date.now() })
  notify('item/completed', { item: { ...it, startedAtMs: Date.now(), completedAtMs: Date.now() }, threadId, turnId, completedAtMs: Date.now() })
}

function agentMessage(text: string, final: boolean) {
  return { type: 'agentMessage', id: `msg_${uuid()}`, text, phase: final ? 'final_answer' : 'commentary', memoryCitation: null, delivery: null, questions: null }
}

async function runTurn(t: Thread, turnId: string, text: string) {
  const threadId = t.id
  notify('turn/started', { threadId, turn: turnObject(turnId, 'inProgress') })
  item(threadId, turnId, { type: 'userMessage', id: uuid(), clientId: null, content: [{ type: 'text', text, text_elements: [] }] })
  const notes: string[] = []
  if (text.includes('[crash]')) {
    await sleep(20)
    process.exit(1)
  }
  const slow = text.match(/\[slow:(\d+)\]/)
  if (slow) {
    const end = Date.now() + Number(slow[1])
    let n = 0
    while (Date.now() < end) {
      if (t.active?.interrupted) break
      item(threadId, turnId, agentMessage(`Working, step ${++n}`, false))
      await sleep(100)
    }
  }
  if (t.active?.interrupted) {
    t.active = null
    notify('turn/completed', { threadId, turn: turnObject(turnId, 'interrupted') })
    return
  }
  item(threadId, turnId, {
    type: 'commandExecution', id: `exec-${uuid()}`, pluginId: null, scriptPath: null, command: '/bin/zsh -lc "ls"', cwd: t.cwd,
    processId: '1', source: 'unifiedExecStartup', status: 'completed', commandActions: [{ type: 'unknown', command: 'ls' }],
    aggregatedOutput: 'README.md\n', exitCode: 0, durationMs: 1,
  })
  const write = text.match(/\[write:([^\]]+)\]/)
  if (write) {
    writeFileSync(join(t.cwd, write[1]!), 'written by the fake agent\n')
    item(threadId, turnId, { type: 'fileChange', id: uuid(), changes: [{ path: join(t.cwd, write[1]!), kind: { type: 'add' }, diff: '' }], status: 'completed' })
  }
  if (text.includes('[approval]')) {
    const res = await ask('item/commandExecution/requestApproval', { threadId, turnId, itemId: uuid(), startedAtMs: Date.now(), command: 'rm -rf build', cwd: t.cwd, reason: 'cleanup' })
    notes.push(`approval answer: ${JSON.stringify(res)}`)
  }
  if (text.includes('[ask]')) {
    const input = await ask('item/tool/requestUserInput', { threadId, turnId, itemId: uuid(), questions: [{ id: 'q1', header: 'Pick', question: 'Which one?', isOther: false, isSecret: false, options: null }], isBlocking: true })
    notes.push(`input answer: ${JSON.stringify(input)}`)
    const elicit = await ask('mcpServer/elicitation/request', { threadId, turnId, serverName: 'x', mode: 'form', _meta: null, message: 'Need info', requestedSchema: { type: 'object', properties: {} } })
    notes.push(`elicitation answer: ${JSON.stringify(elicit)}`)
  }
  t.turns++
  if (text.includes('[fail]')) {
    t.active = null
    notify('turn/completed', { threadId, turn: turnObject(turnId, 'failed', [], { message: 'fake failure', codexErrorInfo: null, additionalDetails: null, misalignment: null }) })
    return
  }
  const finalItems = []
  if (!text.includes('[silent]')) {
    const msg = agentMessage([`Fake done (turn ${t.turns} on this thread): ${text.split('\n')[0]}`, ...notes].join('\n'), true)
    item(threadId, turnId, msg)
    finalItems.push({ ...msg, startedAtMs: Date.now(), completedAtMs: Date.now() })
  }
  t.active = null
  notify('turn/completed', { threadId, turn: turnObject(turnId, 'completed', finalItems) })
}

const rl = createInterface({ input: process.stdin })
rl.on('line', line => {
  if (!line.trim()) return
  const msg = JSON.parse(line)
  trace('<<', msg)
  if (msg.id !== undefined && msg.method === undefined) {
    serverRequests.get(msg.id)?.(msg.result ?? { error: msg.error })
    serverRequests.delete(msg.id)
    return
  }
  const { id, method, params } = msg
  switch (method) {
    case 'initialize':
      return respond(id, 'initialize', { userAgent: 'codex_cli_rs/0.167.2 (fake)', codexHome: '/tmp/fake-codex-home', platformFamily: 'unix', platformOs: 'macos' })
    case 'initialized':
      return
    case 'model/list':
      return respond(id, 'model/list', {
        nextCursor: null,
        data: MODELS.map(m => ({
          id: m.id, model: m.id, upgrade: null, upgradeInfo: null, availabilityNux: null, displayName: m.id.toUpperCase(),
          description: 'fake', modelSpecialty: null, hidden: false, supportedReasoningEfforts: m.efforts.map(e => ({ reasoningEffort: e, description: e })),
          defaultReasoningEffort: m.def, inputModalities: ['text'], supportsPersonality: false, multiAgentVersion: null,
          additionalSpeedTiers: [], serviceTiers: [], defaultServiceTier: null, availableAccessPrograms: null, isDefault: m.isDefault,
        })),
      })
    case 'config/read':
      return respond(id, 'config/read', { config: { model: process.env.FAKE_CODEX_DEFAULT_MODEL ?? 'fake-big', model_reasoning_effort: 'medium' }, origins: {}, layers: null })
    case 'thread/start': {
      const t: Thread = { id: uuid(), cwd: params.cwd ?? process.cwd(), model: params.model ?? 'fake-big', turns: 0, active: null }
      threads.set(t.id, t)
      return respond(id, 'thread/start', startResponse(t))
    }
    case 'thread/resume': {
      let t = threads.get(params.threadId)
      if (!t) {
        t = { id: params.threadId, cwd: params.cwd ?? process.cwd(), model: params.model ?? 'fake-big', turns: 0, active: null }
        threads.set(t.id, t)
      }
      return respond(id, 'thread/resume', startResponse(t))
    }
    case 'turn/start': {
      const t = threads.get(params.threadId)
      if (!t) return out({ id, error: { code: -32600, message: 'thread not loaded' } })
      const turnId = uuid()
      t.active = { id: turnId, interrupted: false }
      respond(id, 'turn/start', { turn: turnObject(turnId, 'inProgress') })
      const text = params.input?.[0]?.text ?? ''
      void runTurn(t, turnId, text)
      return
    }
    case 'turn/interrupt': {
      const t = threads.get(params.threadId)
      const active = t?.active
      if (active && active.id === params.turnId) active.interrupted = true
      return respond(id, 'turn/interrupt', {})
    }
    default:
      if (id !== undefined) out({ id, error: { code: -32601, message: `fake: ${method} not implemented` } })
  }
})
