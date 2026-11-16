// Layer 4: live end-to-end runs with real Claude Code and real Codex
// (ADR-0016). Manual or scheduled only: each run spends Claude and Codex tokens.
//
//   npm run build
//   node test/live/live.ts [scenario ...]        (default: all)
//
// Each scenario runs headless `claude -p` in stream-json mode with this repo as
// a plugin (--plugin-dir), the backgrounding settings passed with --settings,
// and a private HEINZEL_HOME. Codex uses the real CODEX_HOME, so it must be
// signed in. Logs go to $HEINZEL_LIVE_OUT (default: a temp folder).

import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const CODEX_MODEL = process.env.HEINZEL_LIVE_CODEX_MODEL ?? 'gpt-6-luna'
const CODEX_EFFORT = process.env.HEINZEL_LIVE_CODEX_EFFORT ?? 'low'
const CLAUDE_MODEL = process.env.HEINZEL_LIVE_CLAUDE_MODEL ?? 'sonnet'
const TOOL = (n: string) => `mcp__plugin_heinzel_heinzel__${n}`
const TOOLS = ['dispatch', 'roster', 'status', 'recall', 'follow_up', 'transcript'].map(TOOL)

interface Event { at: number; msg: any }
interface Run {
  dir: string
  repo: string
  hzHome: string
  events: Event[]
  log: string
}

interface Step { prompt: string; results: number }
interface Scenario {
  name: string
  settings?: boolean
  steps: (ctx: { repo: string }) => Step[]
  timeoutMs?: number
  allowedTools?: string[]
  check: (run: Run, a: Asserter) => void | Promise<void>
}

class Asserter {
  failures: string[] = []
  notes: string[] = []
  ok(cond: unknown, what: string) {
    if (!cond) this.failures.push(what)
    else this.notes.push(`ok: ${what}`)
  }
  note(text: string) {
    this.notes.push(text)
  }
}

const PREFIX = `You are testing the Heinzel plugin. Codex model: ${CODEX_MODEL}, effort: ${CODEX_EFFORT}. Keep every brief tiny. Do not do the agents' work yourself.`

function toolUses(run: Run, name?: string) {
  return run.events.flatMap(e => e.msg.type === 'assistant'
    ? (e.msg.message.content as any[]).filter(c => c.type === 'tool_use' && (!name || c.name === name)).map(c => ({ at: e.at, ...c }))
    : [])
}
function toolResults(run: Run) {
  return run.events.flatMap(e => e.msg.type === 'user' && Array.isArray(e.msg.message.content)
    ? (e.msg.message.content as any[]).filter(c => c.type === 'tool_result').map(c => ({ at: e.at, ...c, text: typeof c.content === 'string' ? c.content : (c.content ?? []).map((x: any) => x.text ?? '').join('\n') }))
    : [])
}
function system(run: Run, subtype: string) {
  return run.events.filter(e => e.msg.type === 'system' && e.msg.subtype === subtype)
}
function finalTexts(run: Run) {
  return run.events.flatMap(e => e.msg.type === 'assistant' ? (e.msg.message.content as any[]).filter(c => c.type === 'text').map(c => c.text as string) : [])
}
function tasksIndex(run: Run) {
  const dirs = existsSync(run.hzHome) ? execFileSync('ls', [run.hzHome]).toString().split('\n').filter(d => d.startsWith('codex-')) : []
  return dirs.flatMap(d => {
    const f = join(run.hzHome, d, 'tasks.json')
    return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')).tasks : []
  })
}
function backgroundDelays(run: Run, name: string) {
  // From the tool_use to Claude Code's task_started for that call.
  return toolUses(run, TOOL(name)).map(u => {
    const started = system(run, 'task_started').find(e => e.msg.tool_use_id === u.id)
    return started ? started.at - u.at : null
  })
}

const scenarios: Scenario[] = [
  {
    name: 'dispatch-wake',
    steps: () => [{
      prompt: `${PREFIX} Call roster, then dispatch one task with brief: "Create a file hello.txt in the current directory containing exactly the word hi, then reply DONE." Then end your turn without waiting. When you are woken with the result, reply with WOKEN: followed by the agent's final message.`,
      results: 2,
    }],
    check: (run, a) => {
      a.ok(toolUses(run, TOOL('roster')).length >= 1, 'roster was called')
      a.ok(toolUses(run, TOOL('dispatch')).length === 1, 'one dispatch')
      const delays = backgroundDelays(run, 'dispatch')
      a.note(`dispatch moved to the background after ${delays.join(', ')} ms (tool_use to task_started)`)
      a.ok(delays[0] !== null && delays[0]! < 4000, 'dispatch moved to the background within about a second')
      a.ok(toolResults(run).some(r => /moved to the background/.test(r.text)), 'Claude got the "moved to the background" result')
      a.ok(system(run, 'task_notification').some(e => e.msg.status === 'completed'), 'Claude Code delivered a completion notification')
      a.ok(finalTexts(run).some(t => /WOKEN:/.test(t)), 'Claude was woken and reported the result')
      a.ok(existsSync(join(run.repo, 'hello.txt')) && readFileSync(join(run.repo, 'hello.txt'), 'utf8').trim() === 'hi', 'Codex created hello.txt')
      a.ok(!toolUses(run, TOOL('status')).length, 'Claude did not poll status')
      const t = tasksIndex(run)[0]
      a.ok(t?.status === 'done' && t?.model === CODEX_MODEL, `task done on ${CODEX_MODEL}`)
    },
  },
  {
    name: 'follow-up',
    steps: () => [
      { prompt: `${PREFIX} Dispatch one task with brief: "Create notes.txt containing the line one." End your turn; when woken, reply WOKEN.`, results: 2 },
      { prompt: 'Now use follow_up on that same task to ask it to append a second line, two, to notes.txt. End your turn; when woken, reply WOKEN AGAIN.', results: 2 },
    ],
    check: (run, a) => {
      a.ok(toolUses(run, TOOL('follow_up')).length === 1, 'follow_up was called once')
      const fuDelay = backgroundDelays(run, 'follow_up')
      a.note(`follow_up moved to the background after ${fuDelay.join(', ')} ms`)
      a.ok(fuDelay[0] !== null && fuDelay[0]! < 4000, 'follow_up moved to the background')
      a.ok(finalTexts(run).some(t => /WOKEN AGAIN/.test(t)), 'woken after the follow-up')
      const notes = existsSync(join(run.repo, 'notes.txt')) ? readFileSync(join(run.repo, 'notes.txt'), 'utf8') : ''
      a.ok(/one\s*\n\s*two/.test(notes), 'notes.txt has both lines')
      const tasks = tasksIndex(run)
      a.ok(tasks.length === 1 && tasks[0].turns === 2, 'one task with two turns on the same thread')
    },
  },
  {
    name: 'taskstop',
    steps: () => [{
      prompt: `${PREFIX} Dispatch one task with brief: "Run the shell command sleep 300, then reply finished." As soon as it has moved to the background, stop that background task with the TaskStop tool. Then reply STOPPED.`,
      results: 1,
    }],
    allowedTools: ['TaskStop'],
    check: async (run, a) => {
      a.ok(toolUses(run, 'TaskStop').length >= 1, 'Claude used TaskStop')
      await new Promise(r => setTimeout(r, 3000))
      const t = tasksIndex(run)[0]
      a.ok(t?.status === 'cancelled', `the Codex task was cancelled (status ${t?.status})`)
      const transcript = t ? readFileSync(join(run.hzHome, execFileSync('ls', [run.hzHome]).toString().split('\n').find(d => d.startsWith('codex-'))!, 'tasks', `${t.id}.jsonl`), 'utf8') : ''
      a.ok(/"status":"cancelled"/.test(transcript), 'the turn ended as interrupted in the transcript')
    },
  },
  {
    name: 'recall',
    steps: () => [{
      prompt: `${PREFIX} Dispatch one task with label "Sleeper" and brief: "Run the shell command sleep 300, then reply finished." Once it is in the background, cancel it with Heinzel's recall tool, then reply RECALLED.`,
      results: 2,
    }],
    timeoutMs: 240_000,
    check: (run, a) => {
      a.ok(toolUses(run, TOOL('recall')).length === 1, 'recall was called')
      const r = toolResults(run).find(x => /was cancelled/.test(x.text))
      a.ok(r, 'recall reported the task cancelled')
      a.ok(tasksIndex(run)[0]?.status === 'cancelled', 'task status is cancelled')
    },
  },
  {
    name: 'worktree',
    steps: () => [{
      prompt: `${PREFIX} Dispatch one task with worktree: true and brief: "Create a file wt.txt containing the word tree." End your turn; when woken, reply WOKEN with the branch name from the result.`,
      results: 2,
    }],
    check: (run, a) => {
      const t = tasksIndex(run)[0]
      a.ok(t?.worktree?.branch?.startsWith('heinzel/'), `task ran in a worktree (${t?.worktree?.branch})`)
      a.ok(t && existsSync(join(t.worktree.top, 'wt.txt')), 'the file is in the worktree')
      a.ok(!existsSync(join(run.repo, 'wt.txt')), 'the main checkout is untouched')
      const branches = execFileSync('git', ['branch', '--list', 'heinzel/*'], { cwd: run.repo }).toString()
      a.ok(t && branches.includes(t.worktree.branch), 'the branch exists in the repo')
      a.ok(finalTexts(run).some(x => x.includes('heinzel/')), 'Claude reported the branch')
    },
  },
  {
    name: 'roster-validation',
    steps: () => [{
      prompt: `Using Heinzel, dispatch one task to Codex with model "gpt-imaginary-9" and brief "Reply hello." If it fails, don't try anything else: just reply with REJECTED and the list of models the error gave you.`,
      results: 1,
    }],
    check: (run, a) => {
      const err = toolResults(run).find(r => /Unknown model "gpt-imaginary-9"/.test(r.text))
      a.ok(err, 'dispatch rejected the unknown model with the valid list')
      a.ok(err && new RegExp(CODEX_MODEL).test(err.text), 'the error lists real models')
      a.ok(tasksIndex(run).length === 0, 'no task was started on another model')
      a.ok(finalTexts(run).some(t => /REJECTED/.test(t)), 'Claude reported the rejection')
    },
  },
  {
    name: 'parallel',
    steps: () => [{
      prompt: `${PREFIX} In a single message, dispatch two tasks in parallel. Task A brief: "Create a.txt containing A." Task B brief: "Create b.txt containing B." End your turn. When both have finished, reply BOTH DONE.`,
      results: 3,
    }],
    timeoutMs: 300_000,
    check: (run, a) => {
      a.ok(toolUses(run, TOOL('dispatch')).length === 2, 'two dispatches')
      a.ok(backgroundDelays(run, 'dispatch').every(d => d !== null), 'both moved to the background')
      a.ok(system(run, 'task_notification').filter(e => e.msg.status === 'completed').length === 2, 'two completion notifications')
      a.ok(existsSync(join(run.repo, 'a.txt')) && existsSync(join(run.repo, 'b.txt')), 'both files exist')
      a.ok(finalTexts(run).some(t => /BOTH DONE/.test(t)), 'Claude saw both finish')
    },
  },
  {
    name: 'no-settings',
    settings: false,
    steps: () => [{ prompt: `${PREFIX} Dispatch one task with brief: "Reply with the word pong." Then reply with the tool result's last paragraph.`, results: 1 }],
    check: (run, a) => {
      a.ok(system(run, 'task_started').length === 0, 'without the settings, the call was not moved to the background')
      a.ok(toolResults(run).some(r => /background settings aren't set/.test(r.text)), 'the result says which settings to add')
    },
  },
]

async function runScenario(s: Scenario, outDir: string) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `hz-live-${s.name}-`)))
  const repo = join(dir, 'repo')
  mkdirSync(repo)
  const g = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' })
  g('init', '-q', '-b', 'main')
  g('config', 'user.email', 'live@example.com')
  g('config', 'user.name', 'Live')
  writeFileSync(join(repo, 'README.md'), '# Scratch repo for a Heinzel live test\n')
  g('add', '.')
  g('commit', '-q', '-m', 'init')
  const hzHome = join(dir, 'hz')
  const settingsFile = join(dir, 'settings.json')
  writeFileSync(settingsFile, JSON.stringify(s.settings === false ? {} : { env: { CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS: '1000', CLAUDE_AUTO_BACKGROUND_TASKS: '1' } }))
  const log = join(outDir, `${s.name}.jsonl`)
  writeFileSync(log, '')
  const run: Run = { dir, repo, hzHome, events: [], log }

  const env: NodeJS.ProcessEnv = { ...process.env, HEINZEL_HOME: hzHome }
  delete env.CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS
  delete env.CLAUDE_AUTO_BACKGROUND_TASKS
  const args = [
    '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
    '--plugin-dir', ROOT, '--settings', settingsFile, '--model', CLAUDE_MODEL,
    '--allowedTools', [...TOOLS, ...(s.allowedTools ?? [])].join(','),
  ]
  const child = spawn('claude', args, { cwd: repo, env, stdio: ['pipe', 'pipe', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', b => { stderr += b })
  let buf = ''
  let results = 0
  let waiting: { need: number; resolve: () => void } | null = null
  child.stdout.on('data', (b: Buffer) => {
    buf += b.toString()
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i)
      buf = buf.slice(i + 1)
      if (!line.trim()) continue
      let msg
      try { msg = JSON.parse(line) } catch { continue }
      const at = Date.now()
      run.events.push({ at, msg })
      appendFileSync(log, JSON.stringify({ at, msg }) + '\n')
      if (msg.type === 'result') {
        results++
        if (waiting && results >= waiting.need) waiting.resolve()
      }
    }
  })
  const send = (text: string) => child.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: text } }) + '\n')
  const deadline = Date.now() + (s.timeoutMs ?? 240_000)
  let expected = 0
  let timedOut = false
  for (const step of s.steps({ repo })) {
    expected += step.results
    send(step.prompt)
    await new Promise<void>(resolve => {
      if (results >= expected) return resolve()
      waiting = { need: expected, resolve }
      setTimeout(() => { timedOut = true; resolve() }, Math.max(0, deadline - Date.now()))
    })
    if (timedOut) break
  }
  child.stdin.end()
  await new Promise(r => { child.once('exit', r); setTimeout(r, 15000) })
  child.kill()
  const a = new Asserter()
  if (timedOut) a.ok(false, `finished in time (got ${results} of ${expected} results)`)
  try {
    await s.check(run, a)
  } catch (err) {
    a.ok(false, `check threw: ${(err as Error).message}`)
  }
  // Stop the private helper this run started.
  for (const d of existsSync(hzHome) ? execFileSync('ls', [hzHome]).toString().split('\n').filter(x => x.startsWith('codex-')) : []) {
    const lock = join(hzHome, d, 'helper.lock')
    if (existsSync(lock)) try { process.kill(Number(readFileSync(lock, 'utf8')), 'SIGTERM') } catch { /* gone */ }
  }
  const cost = run.events.filter(e => e.msg.type === 'result').reduce((n, e) => n + (e.msg.total_cost_usd ?? 0), 0)
  return { name: s.name, failures: a.failures, notes: a.notes, cost, stderr: stderr.slice(-2000), dir }
}

const outDir = process.env.HEINZEL_LIVE_OUT ?? mkdtempSync(join(tmpdir(), 'hz-live-out-'))
mkdirSync(outDir, { recursive: true })
const wanted = process.argv.slice(2)
const versions = {
  claude: execFileSync('claude', ['--version']).toString().trim(),
  codex: execFileSync('codex', ['--version']).toString().trim(),
}
console.log(`Live run: ${versions.claude}; ${versions.codex}; Codex ${CODEX_MODEL}/${CODEX_EFFORT}; Claude ${CLAUDE_MODEL}. Logs in ${outDir}`)
const summary: any[] = []
for (const s of scenarios.filter(x => !wanted.length || wanted.includes(x.name))) {
  const started = Date.now()
  const r = await runScenario(s, outDir)
  const secs = Math.round((Date.now() - started) / 1000)
  console.log(`\n${r.failures.length ? 'FAIL' : 'PASS'} ${r.name} (${secs}s, Claude $${r.cost.toFixed(3)})`)
  for (const n of r.notes) console.log(`  ${n}`)
  for (const f of r.failures) console.log(`  FAILED: ${f}`)
  if (r.failures.length && r.stderr) console.log(`  stderr: ${r.stderr}`)
  summary.push({ ...r, secs, versions })
}
writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2))
const failed = summary.filter(s => s.failures.length).length
console.log(`\n${summary.length - failed}/${summary.length} scenarios passed.`)
process.exit(failed ? 1 : 0)
