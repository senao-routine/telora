'use strict';

// ローカル Whisper による文字起こし。
// 音声 →(FFmpeg で16kHz mono WAV)→ Whisper(whisper.cpp / openai-whisper) → SRT を返す。
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { FFMPEG, probe } = require('./export');

// GUI 起動時に PATH が貧弱でも検出できるよう、よくある場所を補う
const EXTRA_PATHS = [
  '/opt/homebrew/bin', '/usr/local/bin', '/opt/local/bin', '/usr/bin',
  path.join(os.homedir(), '.local/bin'),
  path.join(os.homedir(), 'Library/Python/3.13/bin'),
  path.join(os.homedir(), 'Library/Python/3.12/bin'),
  path.join(os.homedir(), 'Library/Python/3.11/bin'),
];
const SPAWN_ENV = Object.assign({}, process.env, {
  PATH: [process.env.PATH || '', ...EXTRA_PATHS].join(':'),
});

function binExists(bin) {
  return new Promise((resolve) => {
    let done = false;
    const fin = (v) => { if (!done) { done = true; resolve(v); } };
    let proc;
    try { proc = spawn(bin, ['--help'], { env: SPAWN_ENV, windowsHide: true }); }
    catch (_) { fin(false); return; }
    proc.on('error', () => fin(false)); // ENOENT 等 → 無し
    proc.on('close', () => fin(true));
    proc.stdout && proc.stdout.on('data', () => {});
    proc.stderr && proc.stderr.on('data', () => {});
    setTimeout(() => { try { proc.kill(); } catch (_) {} fin(true); }, 4000);
  });
}

function findWhisperModel() {
  const cands = [];
  if (process.env.WHISPER_MODEL) cands.push(process.env.WHISPER_MODEL);
  const dirs = [
    path.join(os.homedir(), '.cache/whisper'),
    path.join(os.homedir(), 'Library/Application Support/whisper-cpp/models'),
    '/opt/homebrew/share/whisper-cpp/models',
    '/usr/local/share/whisper-cpp/models',
    path.join(os.homedir(), 'whisper.cpp/models'),
    path.join(process.cwd(), 'models'),
  ];
  for (const d of dirs) {
    try {
      const files = fs.readdirSync(d).filter((f) => /ggml.*\.bin$/i.test(f));
      // base / small を優先、無ければ先頭
      files.sort((a, b) => rankModel(a) - rankModel(b));
      if (files.length) cands.push(path.join(d, files[0]));
    } catch (_) { /* noop */ }
  }
  for (const c of cands) { try { if (c && fs.existsSync(c)) return c; } catch (_) {} }
  return null;
}
function rankModel(name) {
  const order = ['small', 'base', 'medium', 'large', 'tiny'];
  for (let i = 0; i < order.length; i++) if (name.includes(order[i])) return i;
  return 99;
}

// 利用可能なエンジンを検出
async function detectEngine() {
  if (await binExists('whisper')) return { type: 'openai', bin: 'whisper' };
  for (const b of ['whisper-cli', 'whisper-cpp']) {
    // eslint-disable-next-line no-await-in-loop
    if (await binExists(b)) {
      const model = findWhisperModel();
      if (model) return { type: 'cpp', bin: b, model };
      return { type: 'cpp-nomodel', bin: b };
    }
  }
  return null;
}

function ffmpegToWav(input, out) {
  return new Promise((resolve) => {
    const args = ['-y', '-hide_banner', '-loglevel', 'error', '-i', input, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', out];
    let proc; let err = '';
    try { proc = spawn(FFMPEG, args, { windowsHide: true }); } catch (e) { resolve({ ok: false, error: String(e) }); return; }
    proc.stderr.on('data', (d) => { err += d.toString(); });
    proc.on('error', (e) => resolve({ ok: false, error: String(e) }));
    proc.on('close', (code) => resolve(code === 0 ? { ok: true } : { ok: false, error: err.slice(-400) }));
  });
}

function parseProgressTime(line) {
  const m = /(\d{1,2}):(\d{2}):(\d{2})(?:[.,](\d{1,3}))?\s*-->/.exec(line)
    || /\[(\d{1,2}):(\d{2})[.,](\d{1,3})/.exec(line);
  if (!m) return null;
  if (m[4] !== undefined || m.length >= 5) return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3] || 0);
  return (+m[1]) * 60 + (+m[2]);
}

function runWhisper(engine, wav, lang, tmpDir, totalDur, onProgress, registerProc) {
  return new Promise((resolve) => {
    let args; let outSrt;
    if (engine.type === 'openai') {
      const model = process.env.WHISPER_OPENAI_MODEL || 'small';
      args = [wav, '--model', model, '--language', lang || 'Japanese', '--task', 'transcribe',
        '--output_format', 'srt', '--output_dir', tmpDir, '--verbose', 'False', '--fp16', 'False'];
      outSrt = path.join(tmpDir, path.basename(wav, path.extname(wav)) + '.srt');
    } else {
      outSrt = path.join(tmpDir, 'out');
      args = ['-m', engine.model, '-f', wav, '-l', lang || 'ja', '-osrt', '-of', outSrt, '-np'];
      outSrt += '.srt';
    }
    let proc; let err = '';
    try { proc = spawn(engine.bin, args, { env: SPAWN_ENV, windowsHide: true }); }
    catch (e) { resolve({ ok: false, error: String(e) }); return; }
    if (registerProc) registerProc(proc);
    const onData = (d) => {
      const s = d.toString();
      err += s;
      const t = parseProgressTime(s);
      if (t != null && totalDur > 0 && onProgress) {
        onProgress(Math.min(0.98, 0.25 + 0.7 * (t / totalDur)), `文字起こし中… ${Math.round(100 * t / totalDur)}%`);
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', (e) => resolve({ ok: false, error: String(e) }));
    proc.on('close', (code) => {
      if (code !== 0) { resolve({ ok: false, error: err.slice(-500) }); return; }
      try { resolve({ ok: true, srt: fs.readFileSync(outSrt, 'utf8') }); }
      catch (e) { resolve({ ok: false, error: 'SRT 出力が見つかりません: ' + String(e) }); }
    });
  });
}

const SETUP_MSG = '文字起こしには Whisper が必要です。次のいずれかを導入してください：\n'
  + '・openai-whisper（推奨・簡単）: pip install -U openai-whisper\n'
  + '・whisper.cpp: brew install whisper-cpp（＋ ggml モデルを ~/.cache/whisper 等に配置、または環境変数 WHISPER_MODEL でパス指定）';

let currentProc = null;
function cancel() { if (currentProc) { try { currentProc.kill('SIGKILL'); } catch (_) {} currentProc = null; return true; } return false; }

async function transcribe(payload, onProgress) {
  const { mediaPath, language } = payload;
  if (!mediaPath) return { ok: false, error: '対象の音声/動画がありません' };

  const engine = await detectEngine();
  if (!engine) return { ok: false, error: SETUP_MSG, needSetup: true };
  if (engine.type === 'cpp-nomodel') {
    return { ok: false, needSetup: true, error: 'whisper.cpp は見つかりましたが ggml モデルがありません。\nモデルを ~/.cache/whisper などに置くか、環境変数 WHISPER_MODEL でパスを指定してください。\n例: bash ./models/download-ggml-model.sh small' };
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tce-stt-'));
  const cleanup = () => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {} };
  try {
    if (onProgress) onProgress(0.05, '音声を抽出しています…');
    const wav = path.join(tmpDir, 'audio.wav');
    const conv = await ffmpegToWav(mediaPath, wav);
    if (!conv.ok) { cleanup(); return { ok: false, error: '音声抽出に失敗しました: ' + conv.error }; }

    let totalDur = 0;
    try { const p = await probe(mediaPath); if (p.ok) totalDur = p.duration; } catch (_) {}

    if (onProgress) onProgress(0.25, `文字起こし中…（${engine.type === 'openai' ? 'openai-whisper' : 'whisper.cpp'}）`);
    const res = await runWhisper(engine, wav, language, tmpDir, totalDur, onProgress, (p) => { currentProc = p; });
    currentProc = null;
    cleanup();
    if (!res.ok) return { ok: false, error: res.error || '文字起こしに失敗しました' };
    if (onProgress) onProgress(1, '完了');
    return { ok: true, srt: res.srt, engine: engine.type };
  } catch (e) {
    cleanup();
    return { ok: false, error: String(e && e.stack || e) };
  }
}

// ---- 単語タイムスタンプ付き文字起こし（フィラーカット用）----
// テロップ用の transcribe とは別経路。word 単位の {word,start,end}（秒）を返す。
function runWhisperWords(engine, wav, lang, tmpDir, registerProc) {
  return new Promise((resolve) => {
    let args; let outJson;
    if (engine.type === 'openai') {
      const model = process.env.WHISPER_OPENAI_MODEL || 'small';
      args = [wav, '--model', model, '--language', lang || 'Japanese', '--task', 'transcribe',
        '--output_format', 'json', '--word_timestamps', 'True', '--output_dir', tmpDir, '--verbose', 'False', '--fp16', 'False'];
      outJson = path.join(tmpDir, path.basename(wav, path.extname(wav)) + '.json');
    } else {
      const of = path.join(tmpDir, 'words');
      args = ['-m', engine.model, '-f', wav, '-l', lang || 'ja', '-oj', '-ml', '1', '-of', of, '-np'];
      outJson = of + '.json';
    }
    let proc; let err = '';
    try { proc = spawn(engine.bin, args, { env: SPAWN_ENV, windowsHide: true }); }
    catch (e) { resolve({ ok: false, error: String(e) }); return; }
    if (registerProc) registerProc(proc);
    proc.stdout.on('data', (d) => { err += d.toString(); });
    proc.stderr.on('data', (d) => { err += d.toString(); });
    proc.on('error', (e) => resolve({ ok: false, error: String(e) }));
    proc.on('close', (code) => {
      if (code !== 0) { resolve({ ok: false, error: err.slice(-500) }); return; }
      try {
        const j = JSON.parse(fs.readFileSync(outJson, 'utf8'));
        const words = [];
        if (Array.isArray(j.segments)) {
          // openai-whisper 形式: segments[].words[{word,start,end}]
          for (const s of j.segments) for (const w of (s.words || [])) {
            if (w && w.word != null && w.start != null && w.end != null) words.push({ word: String(w.word), start: +w.start, end: +w.end });
          }
        }
        if (!words.length && Array.isArray(j.transcription)) {
          // whisper.cpp 形式: transcription[].offsets.{from,to}(ms), text
          for (const t of j.transcription) {
            const o = t.offsets || {};
            if (o.from != null && o.to != null) words.push({ word: String(t.text || ''), start: o.from / 1000, end: o.to / 1000 });
          }
        }
        resolve({ ok: true, words });
      } catch (e) { resolve({ ok: false, error: '単語JSONの解析に失敗しました: ' + String(e) }); }
    });
  });
}

async function transcribeWords(payload, onProgress) {
  const { mediaPath, language } = payload || {};
  if (!mediaPath) return { ok: false, error: '対象の音声/動画がありません' };
  const engine = await detectEngine();
  if (!engine) return { ok: false, error: SETUP_MSG, needSetup: true };
  if (engine.type === 'cpp-nomodel') return { ok: false, needSetup: true, error: 'whisper.cpp のモデルがありません。' };
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tce-words-'));
  const cleanup = () => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {} };
  try {
    if (onProgress) onProgress(0.1, '音声を抽出しています…');
    const wav = path.join(tmpDir, 'audio.wav');
    const conv = await ffmpegToWav(mediaPath, wav);
    if (!conv.ok) { cleanup(); return { ok: false, error: '音声抽出に失敗しました: ' + conv.error }; }
    if (onProgress) onProgress(0.3, 'フィラー語を解析しています…');
    const res = await runWhisperWords(engine, wav, language, tmpDir, (p) => { currentProc = p; });
    currentProc = null; cleanup();
    if (!res.ok) return { ok: false, error: res.error };
    if (onProgress) onProgress(1, '完了');
    return { ok: true, words: res.words, engine: engine.type };
  } catch (e) { cleanup(); return { ok: false, error: String(e && e.stack || e) }; }
}

module.exports = { transcribe, transcribeWords, detectEngine, cancel };
