// 回帰テスト用の軽量フィクスチャ動画を生成する（バイナリはコミットしない・.gitignore 済み）。
// 6秒・320x240・音声は「1〜3秒のみ 440Hz トーン、それ以外は完全無音」→ cutSilence の made>=1 を決定的に検証できる。
// 使い方: node tests/fixtures/make-fixture.js [--force]
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FIXTURE = path.join(__dirname, 'sample.mp4');

function ensureFixture({ force = false } = {}) {
  if (!force && fs.existsSync(FIXTURE) && fs.statSync(FIXTURE).size > 0) return FIXTURE;
  const ffmpeg = require('ffmpeg-static'); // devDependency
  const args = [
    '-y',
    '-f', 'lavfi', '-i', 'color=c=steelblue:s=320x240:d=6:r=30',
    '-f', 'lavfi', '-i', "aevalsrc=if(between(t\\,1\\,3)\\,0.6*sin(2*PI*440*t)\\,0):s=44100:d=6",
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast',
    '-c:a', 'aac', '-shortest', FIXTURE,
  ];
  const r = spawnSync(ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  if (r.status !== 0 || !fs.existsSync(FIXTURE)) {
    throw new Error('フィクスチャ生成に失敗: ' + (r.stderr ? r.stderr.toString().slice(-500) : r.error));
  }
  return FIXTURE;
}

if (require.main === module) {
  const p = ensureFixture({ force: process.argv.includes('--force') });
  console.log('fixture OK: ' + p + ' (' + fs.statSync(p).size + ' bytes)');
}

module.exports = { ensureFixture, FIXTURE };
