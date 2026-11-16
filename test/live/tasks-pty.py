#!/usr/bin/env python3
"""Live check of the MCP tasks path (ADR-0005, ADR-0016 layer 4).

MCP tasks are behind a feature flag in Claude Code. On the account this was
built on, they only turn on in an interactive terminal with feature-flag
fetching off (DISABLE_TELEMETRY=1). This script runs `claude` under a pty with
the plugin loaded and *no* backgrounding settings, accepts the folder-trust
prompt, asks for one tiny dispatch, and then checks the relay's wire trace:
the dispatch must have been answered with a task and finished through
tasks/get.

Usage: python3 test/live/tasks-pty.py   (run `npm run build` first)
"""
import json, os, pty, re, select, subprocess, sys, tempfile, time

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MODEL = os.environ.get('HEINZEL_LIVE_CODEX_MODEL', 'gpt-6-luna')
work = os.path.realpath(tempfile.mkdtemp(prefix='hz-live-tasks-'))
repo = os.path.join(work, 'repo')
os.makedirs(repo)
for args in (['init', '-q', '-b', 'main'], ['config', 'user.email', 'live@example.com'], ['config', 'user.name', 'Live']):
    subprocess.run(['git', *args], cwd=repo, check=True)
open(os.path.join(repo, 'README.md'), 'w').write('scratch\n')
subprocess.run(['git', 'add', '.'], cwd=repo, check=True)
subprocess.run(['git', 'commit', '-q', '-m', 'init'], cwd=repo, check=True)
settings = os.path.join(work, 'settings.json')
open(settings, 'w').write('{}')
trace = os.path.join(work, 'wire.txt')

# A plain terminal's environment: drop everything a parent Claude Code session
# (the desktop app, an SDK host) passes down, which changes what Claude Code
# turns on (for example CLAUDE_CODE_ENTRYPOINT=claude-desktop).
DROP = ('CLAUDE', 'ANTHROPIC', 'MCP_', 'DISABLE_', 'CLAUDECODE')
env = {k: v for k, v in os.environ.items() if not k.startswith(DROP)}
env.update(DISABLE_TELEMETRY='1', HEINZEL_HOME=os.path.join(work, 'hz'), HEINZEL_TRACE_WIRE=trace, TERM='xterm-256color')
tools = ','.join(f'mcp__plugin_heinzel_heinzel__{t}' for t in ('dispatch', 'roster', 'status', 'recall', 'follow_up', 'transcript'))
prompt = (f'Use Heinzel to dispatch one task to Codex with model {MODEL}, effort low, label "Tasks probe", and brief '
          '"Create tasks.txt containing the word ok." Then end your turn without waiting. '
          'When you are woken with the result, reply with the words BLUE and TASK joined by an underscore.')
argv = ['claude', '--plugin-dir', ROOT, '--settings', settings, '--model', 'sonnet', '--allowedTools', tools]

pid, fd = pty.fork()
if pid == 0:
    os.chdir(repo)
    os.execvpe(argv[0], argv, env)

strip = lambda b: re.sub(rb'\x1b\[[0-9;?<>]*[a-zA-Z~]|\x1b\][^\x07]*\x07', b'', b)
out, trusted, sent, deadline = b'', False, False, time.time() + 300
while time.time() < deadline:
    r, _, _ = select.select([fd], [], [], 0.5)
    if r:
        try:
            out += os.read(fd, 65536)
        except OSError:
            break
    flat = strip(out).replace(b' ', b'')
    if not trusted and b'Itrustthisfolder' in flat:
        # The default answer is "No, exit": move down to "Yes, I trust this folder".
        time.sleep(0.5)
        os.write(fd, b'\x1b[B')
        time.sleep(0.3)
        os.write(fd, b'\r')
        trusted = True
    # Type the prompt once the input box is ready (a prompt passed on the
    # command line is dropped when the trust dialog shows first).
    if not sent and (trusted or b'Itrustthisfolder' not in flat) and b'shift+tabtocycle' in flat:
        time.sleep(2)
        os.write(fd, prompt.encode())
        time.sleep(1)
        os.write(fd, b'\r')
        sent = True
    if b'BLUE_TASK' in flat:
        time.sleep(2)
        break
try:
    os.kill(pid, 9)
except Exception:
    pass
open(os.path.join(work, 'tty.txt'), 'wb').write(strip(out))

# Stop the private helper.
for d in os.listdir(os.path.join(work, 'hz')) if os.path.isdir(os.path.join(work, 'hz')) else []:
    lock = os.path.join(work, 'hz', d, 'helper.lock')
    if os.path.exists(lock):
        try: os.kill(int(open(lock).read()), 15)
        except Exception: pass

lines = [l for l in open(trace).read().splitlines()] if os.path.exists(trace) else []
msgs = [(l[:2], json.loads(l[3:])) for l in lines]
calls = [m for d, m in msgs if d == '<<' and m.get('method') == 'tools/call' and m['params'].get('name') == 'dispatch']
task_replies = [m for d, m in msgs if d == '>>' and isinstance(m.get('result'), dict) and m['result'].get('resultType') == 'task']
gets = [m for d, m in msgs if d == '<<' and m.get('method') == 'tasks/get']
completed = [m for d, m in msgs if d == '>>' and isinstance(m.get('result'), dict) and m['result'].get('status') == 'completed']
checks = {
    'Claude Code offered the tasks extension on the dispatch call': any('io.modelcontextprotocol/tasks' in json.dumps(c['params'].get('_meta', {})) for c in calls),
    'dispatch was answered with a task': bool(task_replies),
    f'Claude Code polled tasks/get ({len(gets)} times)': bool(gets),
    'tasks/get returned the completed result': bool(completed),
    'Codex created tasks.txt': os.path.exists(os.path.join(repo, 'tasks.txt')),
    'Claude was woken (BLUE_TASK on screen)': b'BLUE_TASK' in strip(out).replace(b' ', b''),
}
for k, v in checks.items():
    print(('ok:     ' if v else 'FAILED: ') + k)
print(f'logs: {work}')
sys.exit(0 if all(checks.values()) else 1)
