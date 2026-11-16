// The display mod against seeded state files (ADR 16 layer 3).
// Run with: claude plugin test .

import { expect, test } from 'claude-code/testing'

const NOW = Date.now()
const index = {
  format: 1,
  account: 'codex-abc',
  agent: 'codex',
  helperPid: 1,
  updatedAt: NOW,
  tasks: [
    {
      id: 'task_run00001', label: 'Fix the login test', agent: 'codex', model: 'gpt-6-luna', effort: 'low', status: 'running',
      sessionId: 'S', cwd: '/repo', worktree: null, threadId: 't1', turnId: 'u1', turns: 1,
      createdAt: NOW - 90_000, updatedAt: NOW - 1000, finishedAt: null, lastLine: '$ npm test', result: null, error: null,
    },
    {
      id: 'task_done0001', label: 'Write the README', agent: 'codex', model: 'gpt-6-luna', effort: 'low', status: 'done',
      sessionId: 'S', cwd: '/repo', worktree: { top: '/wt/x', path: '/wt/x', branch: 'heinzel/write-the-readme-done0001', base: 'abc', repo: '/repo' },
      threadId: 't2', turnId: 'u2', turns: 2, createdAt: NOW - 600_000, updatedAt: NOW - 300_000, finishedAt: NOW - 300_000,
      lastLine: 'README written.', result: 'README written.', error: null,
    },
  ],
}
const transcript = [
  { t: NOW - 600_000, kind: 'brief', text: ['Write a README for the repo.', ...Array.from({ length: 9 }, (_, n) => `line ${n + 2}`)].join('\n'), model: 'gpt-6-luna', effort: 'low', cwd: '/repo' },
  { t: NOW - 590_000, kind: 'command', command: 'ls', exitCode: 0, output: 'src\n', title: 'Listed files in .' },
  { t: NOW - 585_000, kind: 'command', command: 'npm test', exitCode: 2, output: 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk\nl\n' },
  { t: NOW - 580_000, kind: 'edit', files: [{ path: '/wt/x/README.md', kind: 'add', added: 12, removed: 0 }] },
  { t: NOW - 570_000, kind: 'message', text: 'README written.', final: true },
  { t: NOW - 570_000, kind: 'status', status: 'done', error: null },
].map(e => JSON.stringify(e)).join('\n')

const FILES: Record<string, string> = {
  '/hz/codex-abc/tasks.json': JSON.stringify(index),
  '/hz/codex-abc/tasks/task_done0001.jsonl': transcript,
}

const PANE = {
  plugin: 'heinzel',
  component: 'Pane',
  requestId: 'heinzel',
  props: { title: 'Heinzel', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const BAND = {
  plugin: 'heinzel',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 5, scroll: { offset: 0, bodyRows: 5 }, view: {} },
} as const

function seed(on: any, files: Record<string, string> = FILES, opened: string[] = []) {
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('clock.every', () => ({ value: {} }))
  on('env.get', (_: any, e: any) => ({ value: e.name === 'HEINZEL_HOME' ? '/hz' : '/home' }))
  on('fs.exists', (_: any, e: any) => ({ value: e.path === '/hz' && Object.keys(files).length > 0 }))
  on('fs.list', (_: any, e: any) => ({
    value: e.path === '/hz'
      ? [{ name: 'codex-abc', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }, { name: 'worktrees', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }]
      : [],
  }))
  on('fs.read', (_: any, e: any) => {
    if (!(e.path in files)) throw new Error(`ENOENT ${e.path}`)
    return { value: files[e.path] }
  })
  on('command.register', () => ({ value: { command: 'heinzel' } }))
  on('ui.open', (_: any, e: any) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
}

test('the panel lists tasks, opens a transcript and goes back', async ($, on) => {
  seed(on)
  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ key: 'open-task_run00001' }))?.text).toContain('● Fix the login test')
    expect((await ui.find({ key: 'open-task_done0001' }))?.text).toContain('✓ Write the README')
    expect((await ui.find({ type: 'Text', text: /running · \$ npm test/ }))).toBeDefined()

    await ui.press({ key: 'open-task_done0001' })
    expect((await ui.find({ type: 'Text', text: /Write a README for the repo/ }))).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /heinzel\/write-the-readme-done0001/ }))).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /Done in 30s$/ }))).toBeDefined()

    await ui.press({ key: 'back' })
    expect((await ui.find({ key: 'open-task_run00001' }))).toBeDefined()
    await ui.unmount()
  }
})

test('on the terminal, the transcript is drawn as Claude Code draws its own', async ($, on) => {
  seed(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'open-task_done0001' })
  expect((await ui.find({ type: 'Text', text: /^Bash\(ls\)$/ }))).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /^src$/ }))).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /^Write\(\/wt\/x\/README.md\)$/ }))).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /^Exit code 2$/ }))).toBeDefined()
  await ui.unmount()
})

test('on the desktop, tool calls fold into one line that opens on a press', async ($, on) => {
  seed(on)
  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'open-task_done0001' })
  // A long brief shows its first lines and opens in place.
  expect((await ui.find({ key: `p-${NOW - 600_000}` }))?.text).toBe('Show more')
  expect(await ui.find({ type: 'Text', text: /line 10/ })).toBeUndefined()
  await ui.press({ key: `p-${NOW - 600_000}` })
  expect((await ui.find({ type: 'Text', text: /line 10$/ }))).toBeDefined()
  expect((await ui.find({ key: `p-${NOW - 600_000}` }))?.text).toBe('Show less')
  const group = `g-${NOW - 590_000}-1`
  expect((await ui.find({ key: group }))?.text).toBe('Ran 2 commands, edited 1 file +12 · 1 failed ▸')
  expect(await ui.find({ type: 'Text', text: /^\$ ls$/ })).toBeUndefined()
  await ui.press({ key: group })
  expect((await ui.find({ key: group }))?.text).toContain('▾')
  // Each call is a line of its own, titled from what Codex parsed, else the command.
  expect((await ui.find({ key: `c-${NOW - 590_000}-1-0` }))?.text).toBe('Listed files in . ▸')
  expect((await ui.find({ key: `c-${NOW - 590_000}-1-1` }))?.text).toBe('npm test · exit 2 ▸')
  expect((await ui.find({ type: 'Text', text: /^Wrote \/wt\/x\/README.md \+12$/ }))).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^src$/ })).toBeUndefined()
  await ui.press({ key: `c-${NOW - 590_000}-1-0` })
  expect((await ui.find({ type: 'Code' }))).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /^src$/ }))).toBeDefined()
  // An untitled call already shows its command on its line, so no code block repeats it.
  await ui.press({ key: `c-${NOW - 590_000}-1-0` })
  await ui.press({ key: `c-${NOW - 590_000}-1-1` })
  expect(await ui.find({ type: 'Code' })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /^a\nb\nc/ }))).toBeDefined()
  // Long output opens in place: the pane is the only thing that scrolls.
  expect((await ui.find({ key: `o-${NOW - 590_000}-1-1` }))?.text).toBe('… +4 lines')
  expect(await ui.find({ type: 'Text', text: /l$/ })).toBeUndefined()
  await ui.press({ key: `o-${NOW - 590_000}-1-1` })
  expect((await ui.find({ key: `o-${NOW - 590_000}-1-1` }))?.text).toBe('Show less')
  expect((await ui.find({ type: 'Text', text: /^a\n[\s\S]*\nl$/ }))).toBeDefined()
  await ui.unmount()
})

test('the band shows running and recent counts, and closes', async ($, on) => {
  seed(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ type: 'Text', text: /Heinzel/ }))?.text).toBe('Heinzel ● 1 running ✓ 1 done')
    expect((await ui.find({ key: 'heinzel-open' }))).toBeDefined()
    await ui.unmount()
  }
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'heinzel-close' })
  expect(await ui.find({ type: 'Text', text: /Heinzel/ })).toBeUndefined()
  await ui.unmount()
})

test('with no tasks: an empty panel and no band', async ($, on) => {
  seed(on, {})
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await pane.find({ type: 'Text', text: /No Heinzel tasks yet/ }))).toBeDefined()
  await pane.unmount()
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ type: 'Text', text: /Heinzel/ })).toBeUndefined()
  await band.unmount()
})

test('/heinzel opens the panel', async ($, on) => {
  const opened: string[] = []
  seed(on, FILES, opened)
  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
  const res = await $.command.run({ command: 'heinzel', args: '' })
  expect(opened).toContain('heinzel')
  expect(res.text).toContain('Heinzel panel opened')
})
