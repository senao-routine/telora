// Electron 起動＋stdout マーカーパースの共通部。
// require('electron') は plain Node からだとバイナリパス文字列を返す性質を利用して spawn する。
'use strict';
const { spawn } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const ELECTRON_BIN = require('electron'); // devDependency のバイナリパス

const FATAL_MARKERS = ['[did-fail-load]', '[render-process-gone]', '[eval-throw]', '[eval] read error'];

// アプリを起動し、自然終了 or タイムアウトまで待つ。TCE_DEBUG は常に注入。
// 戻り値: { exitCode, timedOut, fatal, lines }
function launchElectron({ appDir, env = {}, timeoutMs = 45000 }) {
  return new Promise((resolve) => {
    const child = spawn(ELECTRON_BIN, [appDir], {
      cwd: ROOT,
      env: { ...process.env, TCE_DEBUG: '1', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const lines = [];
    const bufs = { out: '', err: '' }; // stdout/stderr を別バッファに（改行なし stderr との行混線を防ぐ）
    let fatal = null;
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch (_) { /* noop */ }
      finish({ exitCode: null, timedOut: true, fatal, lines });
    }, timeoutMs);

    const onData = (key) => (chunk) => {
      bufs[key] += chunk.toString('utf8');
      let idx;
      while ((idx = bufs[key].indexOf('\n')) >= 0) {
        const line = bufs[key].slice(0, idx);
        bufs[key] = bufs[key].slice(idx + 1);
        lines.push(line);
        if (!fatal && FATAL_MARKERS.some((m) => line.includes(m))) {
          fatal = line;
          // fatal は即失敗扱い。少し待って残りログを取り込みつつ終了させる。
          setTimeout(() => { try { child.kill('SIGKILL'); } catch (_) { /* noop */ } }, 300);
        }
      }
    };
    child.stdout.on('data', onData('out'));
    child.stderr.on('data', onData('err'));

    child.on('exit', (code) => {
      if (bufs.out.trim()) lines.push(bufs.out);
      if (bufs.err.trim()) lines.push(bufs.err);
      // exit 直後の stream flush を待つ
      setTimeout(() => finish({ exitCode: code, timedOut: false, fatal, lines }), 50);
    });
    child.on('error', (e) => {
      lines.push('[spawn-error] ' + e.message);
      finish({ exitCode: null, timedOut: false, fatal: '[spawn-error] ' + e.message, lines });
    });
  });
}

// prefix を含む最初の行の「prefix 以降」を返す（無ければ null）。
// Electron/macOS が改行なしの雑音を先頭に混ぜることがあるため部分一致にする。
function findMarker(lines, prefix) {
  for (const l of lines) {
    const i = l.indexOf(prefix);
    if (i >= 0) return l.slice(i + prefix.length);
  }
  return null;
}

module.exports = { launchElectron, findMarker, ROOT };
