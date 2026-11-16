// Optional git worktree per task (ADR 10).

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'
import type { Worktree } from '../shared/protocol.ts'

const run = promisify(execFile)

async function git(cwd: string, ...args: string[]) {
  const { stdout } = await run('git', args, { cwd, maxBuffer: 16 * 1024 * 1024 })
  return stdout.trim()
}

export async function repoRoot(cwd: string): Promise<string | null> {
  try {
    return await git(cwd, 'rev-parse', '--show-toplevel')
  } catch {
    return null
  }
}

function slug(label: string) {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'task'
}

// Creates a worktree under `<worktreesDir>/<repo>-<hash>/<task-id>`, on a new
// branch `heinzel/<slug>-<id>` from the current HEAD. Keeping worktrees in
// Heinzel's own folder leaves the user's directories untouched.
export async function createWorktree(cwd: string, worktreesDir: string, taskId: string, label: string): Promise<Worktree> {
  const root = await repoRoot(cwd)
  if (!root) throw new Error(`worktree: true needs a git repository, and ${cwd} isn't in one.`)
  let base: string
  try {
    base = await git(root, 'rev-parse', 'HEAD')
  } catch {
    throw new Error('worktree: true needs at least one commit to branch from.')
  }
  const repoKey = `${basename(root)}-${createHash('sha256').update(root).digest('hex').slice(0, 8)}`
  const top = join(worktreesDir, repoKey, taskId)
  const branch = `heinzel/${slug(label)}-${taskId.replace(/^task_/, '')}`
  await git(root, 'worktree', 'add', '-b', branch, top, base)
  // Run inside the same subfolder the session was in, if there was one.
  const rel = cwd.startsWith(root + '/') ? cwd.slice(root.length + 1) : ''
  return { top, path: rel ? join(top, rel) : top, branch, base, repo: root }
}

// Brings a removed worktree back for a follow-up, on the same branch.
export async function restoreWorktree(wt: Worktree): Promise<Worktree> {
  if (existsSync(wt.top)) return { ...wt, removed: false }
  await git(wt.repo, 'worktree', 'add', wt.top, wt.branch).catch(async () => {
    // The branch was deleted with the worktree; recreate it at the base.
    await git(wt.repo, 'worktree', 'add', '-b', wt.branch, wt.top, wt.base)
  })
  return { ...wt, removed: false }
}

// Removes the worktree and its branch when the task left no changes: nothing
// uncommitted and no commits beyond the base. Returns whether it was removed.
export async function removeIfUnchanged(wt: Worktree): Promise<boolean> {
  if (!existsSync(wt.top)) return true
  try {
    const dirty = await git(wt.top, 'status', '--porcelain')
    const head = await git(wt.top, 'rev-parse', 'HEAD')
    if (dirty || head !== wt.base) return false
    await git(wt.repo, 'worktree', 'remove', wt.top)
    await git(wt.repo, 'branch', '-D', wt.branch)
    return true
  } catch {
    return false
  }
}
