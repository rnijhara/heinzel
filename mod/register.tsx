// Heinzel's display mod (ADR 11): a side panel listing tasks and their
// transcripts, and a band above the input while tasks run. It only reads the
// helper's state files (ADR 12, ADR 17) and never writes them.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Entry, Selected, Task } from './types'
import type { Block } from './model'
import { EDIT_TOOL, MARK, STATUS_COLOR, age, bandCounts, bandText, bandVisible, blocks, clip, commandFailed, duration, outputHead, preview, parseIndex, parseTranscript, relPath, noMatches, signature, sortTasks, summary } from './model'

const PANE = 'heinzel'
const POLL_MS = 1500

const tasksAtom = atom({ plugin: 'heinzel', key: 'tasks' } as const, [], { shape: 'tasks-1' })
const selectedAtom = atom({ plugin: 'heinzel', key: 'selected' } as const, null)
const transcriptAtom = atom({ plugin: 'heinzel', key: 'transcript' } as const, [], { shape: 'transcript-1' })
const bandHiddenAtom = atom({ plugin: 'heinzel', key: 'bandHiddenAt' } as const, 0)
const nowAtom = atom({ plugin: 'heinzel', key: 'now' } as const, 0)
// Tool groups the person opened in the transcript, by `<task id>:<group key>`.
const expandedAtom = atom({ plugin: 'heinzel', key: 'expanded' } as const, [])

let lastSignature = ''
let lastTranscript = ''

async function home($: EngineInterface): Promise<string> {
  const custom = await $.env.get('HEINZEL_HOME')
  if (custom) return custom
  return `${(await $.env.get('HOME')) ?? ''}/.heinzel`
}

async function refresh($: EngineInterface) {
  const root = await home($)
  let tasks: Task[] = []
  if (await $.fs.exists(root)) {
    for (const entry of await $.fs.list(root)) {
      if (entry.kind !== 'dir' || !entry.name.startsWith('codex-')) continue
      const dir = `${root}/${entry.name}`
      const text = await $.fs.read(`${dir}/tasks.json`).catch(() => null)
      if (typeof text === 'string') tasks.push(...parseIndex(text, dir))
    }
  }
  tasks = sortTasks(tasks)
  const sig = signature(tasks)
  if (sig !== lastSignature) {
    lastSignature = sig
    await update($, tasksAtom, () => tasks)
  }
  await update($, nowAtom, () => Date.now())
  const selected: Selected = await read($, selectedAtom)
  if (selected) {
    const text = await $.fs.read(`${selected.dir}/tasks/${selected.id}.jsonl`).catch(() => '')
    const key = `${selected.id}:${typeof text === 'string' ? text.length : 0}`
    if (key !== lastTranscript) {
      lastTranscript = key
      await update($, transcriptAtom, () => parseTranscript(typeof text === 'string' ? text : ''))
    }
  }
}

async function select($: EngineInterface, task: Task | null) {
  lastTranscript = ''
  await update($, selectedAtom, () => (task ? { id: task.id, dir: task.dir } : null))
  if (!task) {
    await update($, transcriptAtom, () => [])
    await update($, expandedAtom, () => [])
  }
  await refresh($)
}

async function openPane($: EngineInterface) {
  // Transparent, so the pane shows the theme's own background, as the transcript does.
  await $.ui.open({ id: PANE, title: 'Heinzel', backgroundColor: 'transparent' })
}

async function hideBand($: EngineInterface) {
  await update($, bandHiddenAtom, () => Date.now())
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'heinzel', description: 'Show Heinzel tasks and their transcripts' })
    await refresh($).catch(() => {})
    $.clock.every(POLL_MS, () => { void refresh($).catch(() => {}) })
    return next(e)
  })

  on('command.run', { command: 'heinzel' }, async $ => {
    await refresh($).catch(() => {})
    await openPane($)
    return { text: 'Heinzel panel opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Markdown, Code } = $.ui.resolve(e) as any
    const tasks: Task[] = await read($, tasksAtom)
    const selected: Selected = await read($, selectedAtom)
    const now: number = (await read($, nowAtom)) || Date.now()
    const task = selected ? tasks.find(t => t.id === selected.id) : undefined

    if (selected && task) {
      const entries: Entry[] = await read($, transcriptAtom)
      const brief = entries.find(e => e.kind === 'brief')
      const cwd = brief?.kind === 'brief' ? brief.cwd ?? null : null
      const elapsed = (task.finishedAt ?? now) - task.createdAt
      return (
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="row" gap={1}>
            <Button key="back" label="← Tasks" onPress={() => select($, null)} />
          </Box>
          <Box flexDirection="column">
            <Text bold><Text color={STATUS_COLOR[task.status]}>{MARK[task.status]}</Text> {task.label}</Text>
            <Text dimColor>
              {task.status} · {duration(elapsed)} · {task.model ?? 'default model'}{task.effort ? ` · ${task.effort}` : ''} · {task.turns} turn{task.turns === 1 ? '' : 's'} · {task.id}
            </Text>
            {task.branch && <Text dimColor>Worktree {task.worktree} on {task.branch}</Text>}
          </Box>
          {entries.length === 0 && <Text dimColor>No transcript yet.</Text>}
          {renderBlocks($, task, entries, cwd, now, await read($, expandedAtom), { Box, Text, Markdown, Button, Code }, Number(e.props?.bodyColumns) || 60, e.surface === 'terminal')}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        {tasks.length === 0 && <Text dimColor>No Heinzel tasks yet. Ask Claude to dispatch one.</Text>}
        {tasks.map(t => (
          <Box key={t.id} flexDirection="column">
            <Button key={`open-${t.id}`} plain onPress={() => select($, t)}>
              <Text color={STATUS_COLOR[t.status]}>{MARK[t.status]}</Text> {clip(t.label, 60)}
            </Button>
            <Text dimColor wrap="truncate-end">
              {age(now - t.createdAt)} · {t.status}{t.lastLine ? ` · ${clip(t.lastLine, 120)}` : ''}
            </Text>
          </Box>
        ))}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const tasks: Task[] = await read($, tasksAtom)
    const hiddenAt: number = await read($, bandHiddenAtom)
    if (e.props?.hasSurvey || !bandVisible(tasks, hiddenAt)) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e) as any
    const counts = bandCounts(tasks, Date.now())
    return (
      <Box flexDirection="row" gap={1} alignItems="center">
        <Text>{bandText(counts)}</Text>
        <Button key="heinzel-open" label="Open panel" onPress={() => openPane($)} />
        <Button key="heinzel-close" label="✕" role="dismiss" onPress={() => hideBand($)} />
      </Box>
    )
  })
}

type UI = { Box: any; Text: any; Markdown: any; Button: any; Code: any }

// A ⏺ row, as the terminal draws a message or a tool call: the dot, then
// content that wraps under itself.
function dotRow(ui: UI, color: string | undefined, head: any, body?: any) {
  const { Box, Text } = ui
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" alignItems="flex-start">
        <Text color={color}>⏺ </Text>
        <Box flexDirection="column" flexShrink={1}>{head}</Box>
      </Box>
      {body}
    </Box>
  )
}

// The ⎿ line under a ⏺ row, indented as the terminal indents a tool result.
function resultRow(ui: UI, content: any) {
  const { Box, Text } = ui
  return (
    <Box flexDirection="row" alignItems="flex-start" paddingLeft={2}>
      <Text dimColor>⎿  </Text>
      <Box flexDirection="column" flexShrink={1}>{content}</Box>
    </Box>
  )
}

// The transcript in Claude Code's own look for the surface (ADR 20, ADR 21).
// Both fold each run of tool calls into one line that opens on a press; the
// terminal adds its ⏺ and ⎿ marks, the other surfaces draw plain text.
// Every color is a theme key, so the view follows the selected theme.
function renderBlocks($: EngineInterface, task: Task, entries: Entry[], cwd: string | null, now: number, open: string[], ui: UI, columns: number, term: boolean) {
  const { Box, Text, Markdown, Button } = ui
  const list = blocks(entries)
  // Opens or closes one group, call, output or brief, by its id.
  const flip = (id: string) => update($, expandedAtom, (keys: string[]) => (keys.includes(id) ? keys.filter(k => k !== id) : [...keys, id]))
  // Colour inside a button, only where hovering doesn't invert it.
  const tint = (color: string) => (term ? undefined : color)
  const rows = list.map((b, i) => {
    switch (b.kind) {
      case 'prompt': {
        // A long brief opens in place, like long command output.
        const id = `${task.id}:p:${b.entry.t}`
        const full = open.includes(id)
        const short = preview(b.entry.text)
        const body = (
          <Box flexDirection="column" gap={1}>
            <Text>{full || !short.cut ? b.entry.text : short.text}</Text>
            {short.cut && (
              <Button key={`p-${b.entry.t}`} plain dimColor onPress={() => flip(id)}>
                {full ? 'Show less' : 'Show more'}
              </Button>
            )}
          </Box>
        )
        // Framed so the brief stands out: on the terminal like Claude Code's
        // own prompt box, elsewhere as a bubble.
        return term
          ? (
            <Box key={`b${i}`} flexDirection="row" alignItems="flex-start" borderStyle="round" borderColor="promptBorder" paddingX={1}>
              <Text dimColor>{'> '}</Text>
              <Box flexDirection="column" flexShrink={1}>{body}</Box>
            </Box>
          )
          : <Box key={`b${i}`} flexDirection="column" borderStyle="round" borderColor="subtle" paddingX={1}>{body}</Box>
      }
      case 'message':
        return (
          <Box key={`b${i}`} flexDirection="column">
            {term ? dotRow(ui, undefined, <Markdown text={b.text} />) : <Markdown text={b.text} />}
          </Box>
        )
      case 'group': {
        const id = `${task.id}:${b.key}`
        const isOpen = open.includes(id)
        const s = summary(b.items)
        // No red inside the line: a partial failure isn't a failed task, and
        // the terminal inverts a button's colours under the pointer.
        const head = (
          <Button key={`g-${b.key}`} plain dimColor onPress={() => flip(id)}>
            {s.text}
            {s.added > 0 && <Text color={tint('diffAdded')}> +{s.added}</Text>}
            {s.removed > 0 && <Text color={tint('diffRemoved')}> −{s.removed}</Text>}
            {s.failed > 0 && ` · ${s.failed} failed`}
            {isOpen ? ' ▾' : ' ▸'}
          </Button>
        )
        const calls = (inset: number) => b.items.map((item, k) => (
          <Box key={`d${k}`} flexDirection="column">
            {renderCall(item, `${b.key}-${k}`, `${id}:${k}`, open, flip, cwd, ui, columns - inset, term)}
          </Box>
        ))
        if (term) {
          return (
            <Box key={`b${i}`} flexDirection="column">
              {/* Red only when every call failed; a partial failure shows in the line. */}
              {dotRow(ui, s.calls > 0 && s.failed === s.calls ? 'error' : 'success', head, isOpen && resultRow(ui, <Box flexDirection="column" gap={1}>{calls(8)}</Box>))}
            </Box>
          )
        }
        return (
          <Box key={`b${i}`} flexDirection="column" gap={1}>
            {head}
            {isOpen && (
              <Box flexDirection="column" borderStyle="round" borderColor="subtle" paddingX={1} paddingY={1} gap={1}>
                {calls(12)}
              </Box>
            )}
          </Box>
        )
      }
      case 'status':
        return <Box key={`b${i}`} flexDirection="column">{renderStatus(b, ui, term)}</Box>
    }
  })
  if (task.status === 'running') {
    const start = [...list].reverse().find((b): b is Extract<Block, { kind: 'prompt' }> => b.kind === 'prompt')?.entry.t ?? task.createdAt
    rows.push(term
      ? <Text key="working" color="claude">✻ Working… <Text dimColor>({duration(now - start)})</Text></Text>
      : <Text key="working" dimColor>Working… ({duration(now - start)})</Text>)
  }
  return rows
}

// One call inside an opened group, as Claude Code lists them: a dim title
// line that opens to the command and its output. The pane is the only thing
// that scrolls, so long output opens in place with "Show all".
function renderCall(item: Entry, key: string, id: string, open: string[], flip: (id: string) => unknown, cwd: string | null, ui: UI, width: number, term: boolean) {
  const isOpen = open.includes(id)
  const { Box, Text, Button, Code } = ui
  switch (item.kind) {
    case 'command': {
      const failed = commandFailed(item)
      const empty = noMatches(item)
      // Cut the title, not the chevron, to the frame's width.
      const room = Math.max(20, width - (failed ? 10 : 2))
      const firstLine = item.command.split('\n')[0]!
      const title = clip(item.title ?? firstLine, room)
      // Without a title the line already shows the command, unless it was cut.
      const showCommand = !!item.title || title !== item.command
      const showAll = open.includes(`${id}:out`)
      const out = outputHead(item.output, failed, showAll ? Infinity : 8)
      const total = out ? out.text.split('\n').length + out.hidden : 0
      return (
        <Box flexDirection="column" gap={1}>
          <Button key={`c-${key}`} plain dimColor onPress={() => flip(id)}>
            {title}
            {failed && (term ? ` · exit ${item.exitCode}` : <Text color="error"> · exit {item.exitCode}</Text>)}
            {empty && ' · no matches'}
            {isOpen ? ' ▾' : ' ▸'}
          </Button>
          {isOpen && (
            <Box flexDirection="column" gap={1}>
              {showCommand && <Code source={`$ ${item.command}`} language="bash" />}
              {out && <Text mono size="footnote" color="inactive">{out.text}</Text>}
              {out && (out.hidden > 0 || showAll) && total > 8 && (
                <Button key={`o-${key}`} plain dimColor onPress={() => flip(`${id}:out`)}>
                  {showAll ? 'Show less' : `… +${out.hidden} lines`}
                </Button>
              )}
              {!out && !empty && <Text size="footnote" color="inactive">(No output)</Text>}
            </Box>
          )}
        </Box>
      )
    }
    case 'edit':
      return (
        <Box flexDirection="column">
          {item.files.map((f, k) => (
            <Text key={`f${k}`} dimColor>
              {EDIT_TOOL[f.kind] === 'Write' ? 'Wrote' : EDIT_TOOL[f.kind] === 'Delete' ? 'Deleted' : 'Updated'} {relPath(f.path, cwd)}
              {(f.added ?? 0) > 0 && <Text color="diffAdded"> +{f.added}</Text>}
              {(f.removed ?? 0) > 0 && <Text color="diffRemoved"> −{f.removed}</Text>}
            </Text>
          ))}
        </Box>
      )
    case 'tool':
      return <Text dimColor>Used {item.name}{item.status === 'failed' ? <Text color="error"> · failed</Text> : ''}</Text>
    default:
      return null
  }
}

function renderStatus(b: Extract<Block, { kind: 'status' }>, ui: UI, term: boolean) {
  const { Box, Text } = ui
  const took = b.startedAt !== null ? ` in ${duration(b.entry.t - b.startedAt)}` : ''
  const word = b.entry.status === 'done' ? 'Done' : b.entry.status === 'failed' ? 'Failed' : 'Cancelled'
  const done = b.entry.status === 'done'
  return (
    <Box flexDirection="column">
      {term
        ? <Text color={STATUS_COLOR[b.entry.status]}>✻ {word}{took}</Text>
        : <Text color={done ? undefined : STATUS_COLOR[b.entry.status]} dimColor={done}>{word}{took}</Text>}
      {b.entry.error && (term ? resultRow(ui, <Text color="error">{b.entry.error}</Text>) : <Text color="error">{b.entry.error}</Text>)}
    </Box>
  )
}
