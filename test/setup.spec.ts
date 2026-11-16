// /heinzel-setup's script. Never touches the real ~/.claude/settings.json.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { SETTINGS_ENV, apply, check } from '../src/setup/cli.ts'
import { ROOT, tempDir } from './helpers.ts'

function fakeCodex(dir: string, signedIn: boolean) {
  const bin = join(dir, 'codex')
  writeFileSync(bin, `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "codex-cli 0.167.2"; exit 0; fi\nif [ "$1" = "login" ]; then ${signedIn ? 'echo "Logged in using ChatGPT"; exit 0' : 'echo "Not logged in"; exit 1'}; fi\n`)
  chmodSync(bin, 0o755)
  return bin
}

describe('/heinzel-setup script', () => {
  test('check reports prerequisites and missing settings', () => {
    const h = tempDir()
    try {
      const file = join(h.dir, 'settings.json')
      writeFileSync(file, JSON.stringify({ model: 'opus', env: { OTHER: 'x' } }))
      const r = check(file, fakeCodex(h.dir, true))
      assert.equal(r.node.ok, true)
      assert.deepEqual(r.codex, { installed: true, version: '0.167.2', signedIn: true, detail: 'Logged in using ChatGPT' })
      assert.equal(r.settings.ok, false)
      assert.deepEqual(r.settings.current, { CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS: null, CLAUDE_AUTO_BACKGROUND_TASKS: null })
      assert.equal(r.ready, false)
      const signedOut = check(file, fakeCodex(h.dir, false))
      assert.equal(signedOut.codex.signedIn, false)
      const missing = check(file, join(h.dir, 'no-such-codex'))
      assert.equal(missing.codex.installed, false)
    } finally {
      h.cleanup()
    }
  })

  test('apply adds only the two keys, keeps the rest, and backs up', () => {
    const h = tempDir()
    try {
      const file = join(h.dir, 'settings.json')
      const original = { model: 'opus', permissions: { allow: ['Bash(ls:*)'] }, env: { OTHER: 'x', CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS: '120000' } }
      writeFileSync(file, JSON.stringify(original))
      const res = apply(file)
      assert.equal(res.changed.length, 2)
      assert.match(res.changed[0]!, /"120000" -> "1000"/)
      const after = JSON.parse(readFileSync(file, 'utf8'))
      assert.deepEqual(after, { ...original, env: { OTHER: 'x', ...SETTINGS_ENV } })
      assert.deepEqual(JSON.parse(readFileSync(res.backup!, 'utf8')), original)
      assert.equal(check(file, fakeCodex(h.dir, true)).ready, true)
      assert.deepEqual(apply(file), { changed: [], backup: null }, 'a second apply changes nothing')
    } finally {
      h.cleanup()
    }
  })

  test('apply creates the file when there is none, and refuses non-objects', () => {
    const h = tempDir()
    try {
      const file = join(h.dir, 'sub', 'settings.json')
      apply(file)
      assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { env: SETTINGS_ENV })
      const arr = join(h.dir, 'arr.json')
      writeFileSync(arr, '[]')
      assert.throws(() => apply(arr), /isn't a JSON object/)
    } finally {
      h.cleanup()
    }
  })

  test('the bundled script runs check and apply against an explicit file', () => {
    const h = tempDir()
    try {
      execFileSync(process.execPath, [join(ROOT, 'scripts/build.ts')], { stdio: 'ignore' })
      const file = join(h.dir, 'settings.json')
      const out = JSON.parse(execFileSync(process.execPath, [join(ROOT, 'dist/setup.mjs'), 'check', '--settings', file], { encoding: 'utf8' }))
      assert.equal(out.settings.file, file)
      const applied = JSON.parse(execFileSync(process.execPath, [join(ROOT, 'dist/setup.mjs'), 'apply', '--settings', file], { encoding: 'utf8' }))
      assert.equal(applied.changed.length, 2)
      assert.ok(existsSync(file))
    } finally {
      h.cleanup()
    }
  })
})
