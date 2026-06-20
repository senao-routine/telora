'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

// FFmpeg / FFprobe の解決。GUI 起動時はシェルの PATH を継承しないことがあるため、
// 環境変数 → よくあるインストール先（Homebrew 等）→ 素の名前 の順で探す。
function resolveBin(name) {
  const envOverride = process.env[`${name.toUpperCase()}_PATH`];
  if (envOverride) return envOverride;
  if (process.platform === 'win32') return name;
  const candidates = [
    `/opt/homebrew/bin/${name}`, // Apple Silicon Homebrew
    `/usr/local/bin/${name}`,    // Intel Homebrew / 手動
    `/opt/local/bin/${name}`,    // MacPorts
    `/usr/bin/${name}`,
  ];
  for (const c of candidates) { try { if (fs.existsSync(c)) return c; } catch (_) { /* noop */ } }
  return name; // 最後は PATH に委ねる
}
const FFMPEG = resolveBin('ffmpeg');
const FFPROBE = resolveBin('ffprobe');

/**
 * 指定コマンドを実行し、終了コード・stdout・stderr を返す。
 */
function run(cmd, args, { onStderr } = {}) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let proc;
    try {
      proc = spawn(cmd, args, { windowsHide: true });
    } catch (err) {
      resolve({ code: -1, stdout: '', stderr: String(err && err.message || err), spawnError: true });
      return;
    }
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => {
      const s = d.toString();
      stderr += s;
      if (onStderr) onStderr(s);
    });
    proc.on('error', (err) => {
      resolve({ code: -1, stdout, stderr: stderr + '\n' + String(err && err.message || err), spawnError: true });
    });
    proc.on('close', (code) => resolve({ code, stdout, stderr, proc }));
    // 呼び出し側がキャンセルできるようハンドルを渡す
    resolve._proc = proc;
  });
}

/**
 * ffmpeg / ffprobe が利用可能か確認する。
 */
async function checkTools() {
  const result = { ffmpeg: false, ffprobe: false, version: '' };
  try {
    const r = await run(FFMPEG, ['-version']);
    if (r.code === 0) {
      result.ffmpeg = true;
      const m = /ffmpeg version (\S+)/.exec(r.stdout);
      result.version = m ? m[1] : '';
    }
  } catch (_) { /* noop */ }
  try {
    const r = await run(FFPROBE, ['-version']);
    if (r.code === 0) result.ffprobe = true;
  } catch (_) { /* noop */ }
  return result;
}

/**
 * 動画ファイルのメタ情報（長さ・解像度・fps・音声有無）を取得する。
 */
async function probe(filePath) {
  const args = [
    '-v', 'error',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    filePath,
  ];
  const r = await run(FFPROBE, args);
  if (r.code !== 0) {
    return { ok: false, error: r.stderr || 'ffprobe failed' };
  }
  let data;
  try {
    data = JSON.parse(r.stdout);
  } catch (e) {
    return { ok: false, error: 'ffprobe 出力の解析に失敗しました' };
  }
  const streams = data.streams || [];
  const v = streams.find((s) => s.codec_type === 'video');
  const a = streams.find((s) => s.codec_type === 'audio');
  let fps = 30;
  if (v && v.r_frame_rate && v.r_frame_rate.includes('/')) {
    const [n, d] = v.r_frame_rate.split('/').map(Number);
    if (d > 0 && n > 0) fps = n / d;
  }
  const duration = parseFloat((data.format && data.format.duration) || (v && v.duration) || '0') || 0;
  return {
    ok: true,
    duration,
    width: v ? v.width : 0,
    height: v ? v.height : 0,
    fps: Math.round(fps * 1000) / 1000,
    hasAudio: !!a,
    hasVideo: !!v,
  };
}

/**
 * 指定時刻のフレームを PNG(dataURL) として抽出する。
 * Chromium がデコードできないコーデック(HEVC 等)でもプレビューを表示するためのフォールバック。
 */
function extractFrame(filePath, time, width) {
  return new Promise((resolve) => {
    const w = Math.max(16, Math.round(width || 640));
    const args = ['-hide_banner', '-loglevel', 'error', '-ss', String(Math.max(0, time || 0)), '-i', filePath,
      '-frames:v', '1', '-vf', `scale=${w}:-2`, '-f', 'image2', '-c:v', 'png', 'pipe:1'];
    let proc;
    try { proc = spawn(FFMPEG, args, { windowsHide: true }); } catch (e) { resolve({ ok: false, error: String(e) }); return; }
    const bufs = []; let err = '';
    proc.stdout.on('data', (d) => bufs.push(d));
    proc.stderr.on('data', (d) => { err += d.toString(); });
    proc.on('error', (e) => resolve({ ok: false, error: String(e) }));
    proc.on('close', (code) => {
      if (code === 0 && bufs.length) resolve({ ok: true, dataUrl: 'data:image/png;base64,' + Buffer.concat(bufs).toString('base64') });
      else resolve({ ok: false, error: err });
    });
  });
}

// probe 結果（音声有無）のキャッシュ
const audioCache = new Map();
async function sourceHasAudio(filePath) {
  if (audioCache.has(filePath)) return audioCache.get(filePath);
  const p = await probe(filePath);
  const has = !!(p.ok && p.hasAudio);
  audioCache.set(filePath, has);
  return has;
}

function escFilterPath(p) {
  // filter graph 内ではこの関数は使わない（パスは入力としてのみ渡すため）
  return p;
}

/**
 * data URL (image/png) を一時 PNG ファイルへ書き出す。
 */
function writeDataUrlPng(dataUrl, file) {
  const idx = dataUrl.indexOf('base64,');
  const b64 = idx >= 0 ? dataUrl.slice(idx + 7) : dataUrl;
  fs.writeFileSync(file, Buffer.from(b64, 'base64'));
}

/**
 * タイムライン（複数レイヤ）を 1 本の動画へ書き出す。
 *
 * payload = {
 *   output: { width, height, fps },
 *   duration: number,                                  // タイムライン総尺(秒)
 *   baseClips: [ { type:'video'|'image', path, in, out, start } ],  // メイントラック
 *   overlays:  [ { dataUrl, start, end } ],            // 出力解像度のフルフレーム透過PNG（テロップ・オーバーレイ画像）
 *   outputPath: string
 * }
 *
 * 合成方針：メイントラックを「時間順セグメントの連結(concat)」で構築（隙間は黒＋無音で補填）。
 * すべて pts 0 始まりに揃えることで overlay の framesync 問題を回避。最後にテロップ／オーバーレイ画像の
 * フルフレーム透過 PNG を時間指定で重畳する。音声は各動画クリップの音声を連結（画像・隙間は無音）。
 */
async function exportTimeline(payload, onProgress, registerProc) {
  const { output, baseClips = [], overlays = [], audioClips = [], outputPath } = payload;
  const layers = payload.layers || null; // 下→上順の合成レイヤ（あれば track 順に厳密合成）
  const hasLayers = layers && layers.length > 0;
  if (baseClips.length === 0 && overlays.length === 0 && audioClips.length === 0 && !hasLayers) {
    return { ok: false, error: '書き出す内容がありません。先に素材をタイムラインへ追加してください。' };
  }

  const W = Math.max(2, Math.round(output.width));
  const H = Math.max(2, Math.round(output.height));
  const FPS = output.fps && output.fps > 0 ? output.fps : 30;

  // 総尺：payload 優先、無ければクリップ終端から算出（速度で尺は素材/速度）
  const tdur = (c) => Math.max(0, c.out - c.in) / ((c.speed && c.speed > 0) ? c.speed : 1);
  let DUR = payload.duration || 0;
  for (const c of baseClips) DUR = Math.max(DUR, c.start + tdur(c));
  for (const o of overlays) DUR = Math.max(DUR, o.end);
  for (const ac of audioClips) DUR = Math.max(DUR, ac.start + tdur(ac));
  if (hasLayers) for (const l of layers) {
    if (l.kind === 'png') DUR = Math.max(DUR, l.end);
    else for (const c of (l.clips || [])) DUR = Math.max(DUR, c.start + tdur(c));
  }
  DUR = Math.max(0.1, DUR);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tce-export-'));
  const cleanup = () => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {} };

  try {
    const inputArgs = [];
    let inputIndex = 0;
    const filterParts = [];

    const SCALE_PAD = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`;
    const AFMT = 'aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo';
    const SILENCE = (d) => `anullsrc=channel_layout=stereo:sample_rate=44100,atrim=0:${d.toFixed(3)},asetpts=PTS-STARTPTS,${AFMT}`;
    // 速度変更：映像は setpts、音声は atempo（範囲外は連鎖）
    const videoSetpts = (sp) => (sp && Math.abs(sp - 1) > 1e-3) ? `setpts=(PTS-STARTPTS)/${sp.toFixed(4)}` : 'setpts=PTS-STARTPTS';
    const atempoChain = (sp) => {
      if (!sp || Math.abs(sp - 1) < 1e-3) return '';
      let r = sp; const parts = [];
      while (r > 2.0 + 1e-6) { parts.push('atempo=2.0'); r /= 2; }
      while (r < 0.5 - 1e-6) { parts.push('atempo=0.5'); r /= 0.5; }
      parts.push(`atempo=${r.toFixed(4)}`);
      return ',' + parts.join(',');
    };
    // クロマキー：キー色を透過（先頭カンマ込み。無ければ空）
    const chromaFilter = (chroma) => {
      if (!chroma || !chroma.on) return '';
      const hex = (chroma.key || '#00ff00').replace('#', '');
      const sim = (chroma.similarity != null ? chroma.similarity : 0.3).toFixed(3);
      const bl = (chroma.blend != null ? chroma.blend : 0.1).toFixed(3);
      return `,colorkey=0x${hex}:${sim}:${bl}`;
    };
    // クロップ（各辺 0..1）を scale 前に適用するフィルタ接頭辞（末尾カンマ込み。無ければ空）
    const cropPrefix = (crop) => {
      if (!crop) return '';
      const l = crop.l || 0, t = crop.t || 0, r = crop.r || 0, b = crop.b || 0;
      if (!(l || t || r || b)) return '';
      return `crop=in_w*${(1 - l - r).toFixed(4)}:in_h*${(1 - t - b).toFixed(4)}:in_w*${l.toFixed(4)}:in_h*${t.toFixed(4)},`;
    };

    // ベースは「タイムライン順のセグメントを連結」して構築する。隙間は黒＋無音で埋め、
    // すべて pts 0 始まりにして overlay の framesync 問題を回避する。
    // 重なりはプレビュー(baseClipAtTime=先勝ち)と一致させるため、後発クリップの隠れる先頭分を詰める。
    const sorted = [...baseClips].sort((a, b) => a.start - b.start);
    const segs = [];
    let cursor = 0;
    for (const c of sorted) {
      const sp = (c.speed && c.speed > 0) ? c.speed : 1; // 速度（タイムライン尺＝素材/速度）
      const cstart = Math.max(0, c.start);
      const cend = cstart + Math.max(0, c.out - c.in) / sp;
      if (cend <= cursor + 1e-3) continue;          // 先行クリップに完全に隠れる
      const visStart = Math.max(cstart, cursor);
      if (visStart > cursor + 1e-3) segs.push({ type: 'black', dur: visStart - cursor });
      const effIn = c.in + (visStart - cstart) * sp; // 重なりで隠れる先頭分をスキップ（素材時間）
      const segDur = Math.max(0.02, (c.out - effIn) / sp);
      segs.push({ type: c.type, clip: c, in: effIn, dur: segDur });
      cursor = visStart + segDur;
    }
    if (cursor < DUR - 1e-3) segs.push({ type: 'black', dur: DUR - cursor });
    if (segs.length === 0) segs.push({ type: 'black', dur: DUR });

    const concatLabels = [];
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      const dur = Math.max(0.02, seg.dur);
      // concat 連結のため全セグメントを同一フォーマット(yuv420p/SAR1/fps)に揃える
      const VFMT = `format=yuv420p,setsar=1,fps=${FPS}`;
      // transform 指定（pw/ph/x/y）があればその大きさ・位置で配置（周囲は黒）。無ければ全画面フィット。
      const place = (seg.clip && seg.clip.pw)
        ? `scale=${seg.clip.pw}:${seg.clip.ph},pad=${W}:${H}:${seg.clip.x}:${seg.clip.y}:color=black,setsar=1`
        : SCALE_PAD;
      // 不透明度（ベースは黒背景なので RGB を op 倍＝黒へブレンドと等価。回転時はアルファ op 倍）
      const bop = (seg.clip && seg.clip.opacity != null) ? seg.clip.opacity : 1;
      const opF = bop < 1 ? `,colorchannelmixer=rr=${bop.toFixed(3)}:gg=${bop.toFixed(3)}:bb=${bop.toFixed(3)}` : '';
      const brot = (seg.clip && seg.clip.rotation) || 0;
      const baaF = bop < 1 ? `,colorchannelmixer=aa=${bop.toFixed(3)}` : '';
      const bcropF = cropPrefix(seg.clip && seg.clip.crop);
      const bchromaF = chromaFilter(seg.clip && seg.clip.chroma);
      const bUseOverlay = !!brot || !!(seg.clip && seg.clip.chroma && seg.clip.chroma.on); // yuva合成経路
      const bsp = (seg.clip && seg.clip.speed) || 1; // 速度
      // フェードイン/アウト（ベース映像は黒へフェード、音声は afade）
      const fi = (seg.clip && seg.clip.fadeIn) || 0, fo = (seg.clip && seg.clip.fadeOut) || 0;
      let vfade = '';
      if (fi > 0) vfade += `,fade=t=in:st=0:d=${fi.toFixed(3)}`;
      if (fo > 0) vfade += `,fade=t=out:st=${Math.max(0, dur - fo).toFixed(3)}:d=${fo.toFixed(3)}`;
      let afadeF = '';
      if (fi > 0) afadeF += `,afade=t=in:st=0:d=${fi.toFixed(3)}`;
      if (fo > 0) afadeF += `,afade=t=out:st=${Math.max(0, dur - fo).toFixed(3)}:d=${fo.toFixed(3)}`;
      // ベースクリップを「黒背景へ（必要なら回転して）overlay」で [v${i}] にする（回転/クロマ用）
      const buildBaseOverlay = (preLabel) => {
        const c = seg.clip; const cx = c.x + c.pw / 2, cy = c.y + c.ph / 2;
        let rl = preLabel;
        if (brot) { const rad = (brot * Math.PI / 180).toFixed(5); filterParts.push(`[${preLabel}]rotate=${rad}:c=black@0:ow=hypot(iw\\,ih):oh=hypot(iw\\,ih)[roB${i}]`); rl = `roB${i}`; }
        filterParts.push(`color=c=black:s=${W}x${H}:r=${FPS}:d=${dur.toFixed(3)},format=yuva420p,setsar=1[bkB${i}]`);
        filterParts.push(`[bkB${i}][${rl}]overlay=x=${cx}-overlay_w/2:y=${cy}-overlay_h/2,${VFMT}${vfade}[v${i}]`);
      };
      if (seg.type === 'black') {
        filterParts.push(`color=c=black:s=${W}x${H}:r=${FPS}:d=${dur.toFixed(3)},${VFMT}[v${i}]`);
        filterParts.push(`${SILENCE(dur)}[a${i}]`);
      } else if (seg.type === 'image') {
        const idx = inputIndex++;
        inputArgs.push('-loop', '1', '-t', dur.toFixed(3), '-i', seg.clip.path);
        if (bUseOverlay) {
          filterParts.push(`[${idx}:v]${bcropF}scale=${seg.clip.pw}:${seg.clip.ph},fps=${FPS},trim=0:${dur.toFixed(3)},setpts=PTS-STARTPTS,format=yuva420p,setsar=1${bchromaF}${baaF}[scB${i}]`);
          buildBaseOverlay(`scB${i}`);
        } else {
          filterParts.push(`[${idx}:v]${bcropF}${place}${opF},trim=0:${dur.toFixed(3)},setpts=PTS-STARTPTS,${VFMT}${vfade}[v${i}]`);
        }
        filterParts.push(`${SILENCE(dur)}[a${i}]`);
      } else {
        const c = seg.clip;
        const inPt = seg.in != null ? seg.in : c.in; // 重なりスキップ後の実イン点
        const idx = inputIndex++;
        inputArgs.push('-i', c.path);
        if (bUseOverlay) {
          filterParts.push(`[${idx}:v]trim=start=${inPt.toFixed(3)}:end=${c.out.toFixed(3)},${videoSetpts(bsp)},${bcropF}scale=${c.pw}:${c.ph},fps=${FPS},format=yuva420p,setsar=1${bchromaF}${baaF}[scB${i}]`);
          buildBaseOverlay(`scB${i}`);
        } else {
          filterParts.push(`[${idx}:v]trim=start=${inPt.toFixed(3)}:end=${c.out.toFixed(3)},${videoSetpts(bsp)},${bcropF}${place}${opF},${VFMT}${vfade}[v${i}]`);
        }
        // eslint-disable-next-line no-await-in-loop
        if (await sourceHasAudio(c.path)) {
          // 音声が映像より短い素材でも concat が破綻しないよう、セグメント尺まで無音パディング
          filterParts.push(`[${idx}:a]atrim=start=${inPt.toFixed(3)}:end=${c.out.toFixed(3)},asetpts=PTS-STARTPTS${atempoChain(bsp)},apad=whole_dur=${dur.toFixed(3)},${AFMT}${afadeF}[a${i}]`);
        } else {
          filterParts.push(`${SILENCE(dur)}[a${i}]`);
        }
      }
      concatLabels.push(`[v${i}][a${i}]`);
    }

    // 連結
    filterParts.push(`${concatLabels.join('')}concat=n=${segs.length}:v=1:a=1[basev][basea]`);

    let prevV = 'basev';

    // 合成レイヤを下→上の順で適用（=タイムラインのトラック順）。上のクリップが下を隠す＝
    // 他ソフト同様のトラック優先合成。layers 未指定時は従来順（動画レイヤ→PNG）で構築。
    let ops;
    if (hasLayers) {
      ops = layers;
    } else {
      ops = [];
      for (const clips of (payload.videoLayers || [])) ops.push({ kind: 'video', clips });
      for (const ov of overlays) ops.push({ kind: 'png', dataUrl: ov.dataUrl, start: ov.start, end: ov.end, anim: ov.anim });
    }

    let opSeq = 0;
    for (const op of ops) {
      if (op.kind === 'video') {
        // 動画レイヤ：全尺の透過RGBA連結（透明な隙間＋各クリップを scale/pad で配置）にして overlay。
        const clips = [...(op.clips || [])].sort((a, b) => a.start - b.start);
        const lsegs = [];
        let lc = 0;
        for (const c of clips) {
          const sp = (c.speed && c.speed > 0) ? c.speed : 1;
          const cs = Math.max(0, c.start);
          const ce = cs + Math.max(0, c.out - c.in) / sp;
          if (ce <= lc + 1e-3) continue;
          const vis = Math.max(cs, lc);
          if (vis > lc + 1e-3) lsegs.push({ gap: true, dur: vis - lc });
          const effIn = c.in + (vis - cs) * sp;
          const segDur = Math.max(0.02, (c.out - effIn) / sp);
          lsegs.push({ c, in: effIn, dur: segDur });
          lc = vis + segDur;
        }
        if (lc < DUR - 1e-3) lsegs.push({ gap: true, dur: DUR - lc });
        if (lsegs.length === 0) continue;

        const L = opSeq++;
        const labels = [];
        for (let i = 0; i < lsegs.length; i++) {
          const s = lsegs[i]; const dur = Math.max(0.02, s.dur); const lab = `lv${L}_${i}`;
          if (s.gap) {
            filterParts.push(`color=c=black@0.0:s=${W}x${H}:r=${FPS}:d=${dur.toFixed(3)},format=yuva420p,setsar=1[${lab}]`);
          } else {
            const c = s.c; const idx = inputIndex++;
            const PAD = `pad=${W}:${H}:${c.x}:${c.y}:color=black@0.0`;
            // 不透明度（透過レイヤなのでアルファを op 倍）
            const lop = (c.opacity != null) ? c.opacity : 1;
            const aaF = lop < 1 ? `,colorchannelmixer=aa=${lop.toFixed(3)}` : '';
            const rot = c.rotation || 0;
            const lcropF = cropPrefix(c.crop);
            // フェードイン/アウト（透過レイヤなのでアルファをフェード）
            const lfi = c.fadeIn || 0, lfo = c.fadeOut || 0;
            let lfade = '';
            if (lfi > 0) lfade += `,fade=t=in:st=0:d=${lfi.toFixed(3)}:alpha=1`;
            if (lfo > 0) lfade += `,fade=t=out:st=${Math.max(0, dur - lfo).toFixed(3)}:d=${lfo.toFixed(3)}:alpha=1`;
            const chromaF = chromaFilter(c.chroma);
            // スケール済み yuva クリップを作る共通部分（クロマキー→不透明度→フェード）
            const sc = `sc${lab}`;
            if (c.type === 'image') {
              inputArgs.push('-loop', '1', '-t', dur.toFixed(3), '-i', c.path);
              filterParts.push(`[${idx}:v]${lcropF}scale=${c.pw}:${c.ph},fps=${FPS},trim=0:${dur.toFixed(3)},setpts=PTS-STARTPTS,format=yuva420p,setsar=1${chromaF}${aaF}${lfade}[${sc}]`);
            } else {
              inputArgs.push('-i', c.path);
              filterParts.push(`[${idx}:v]trim=start=${s.in.toFixed(3)}:end=${c.out.toFixed(3)},${videoSetpts(c.speed || 1)},${lcropF}scale=${c.pw}:${c.ph},fps=${FPS},format=yuva420p,setsar=1${chromaF}${aaF}${lfade}[${sc}]`);
            }
            if (rot) {
              // クリップ中心(cx,cy)まわりに回転し、透明な全画面へ overlay（中心を保ったまま配置）
              const rad = (rot * Math.PI / 180).toFixed(5);
              const cx = c.x + c.pw / 2, cy = c.y + c.ph / 2;
              filterParts.push(`[${sc}]rotate=${rad}:c=black@0:ow=hypot(iw\\,ih):oh=hypot(iw\\,ih)[ro${lab}]`);
              filterParts.push(`color=c=black@0.0:s=${W}x${H}:r=${FPS}:d=${dur.toFixed(3)},format=yuva420p,setsar=1[bl${lab}]`);
              filterParts.push(`[bl${lab}][ro${lab}]overlay=x=${cx}-overlay_w/2:y=${cy}-overlay_h/2[${lab}]`);
            } else {
              filterParts.push(`[${sc}]${PAD}[${lab}]`);
            }
          }
          labels.push(`[${lab}]`);
        }
        filterParts.push(`${labels.join('')}concat=n=${lsegs.length}:v=1[vlayer${L}]`);
        filterParts.push(`[${prevV}][vlayer${L}]overlay=0:0[vlc${L}]`);
        prevV = `vlc${L}`;
      } else if (op.kind === 'png') {
        // フルフレーム PNG オーバーレイ（テロップ・オーバーレイ画像）。PNG は pts 0 始まり。
        const j = opSeq++;
        const pngPath = path.join(tmpDir, `ov_${j}.png`);
        writeDataUrlPng(op.dataUrl, pngPath);
        const s = Math.max(0, op.start), e = Math.max(0, op.end);
        const animated = op.anim && op.anim !== 'none';
        const pfi = op.fadeIn || 0, pfo = op.fadeOut || 0;
        const idx = inputIndex++;
        if (animated || pfi > 0 || pfo > 0) {
          // フェード or アニメ：全尺ループ＋アルファフェード＋表示窓ゲート
          const ad = Math.min(0.45, Math.max(0.05, (e - s) / 2));
          const inD = pfi > 0 ? pfi : (animated ? ad : 0);
          const outD = pfo > 0 ? pfo : (animated ? ad : 0);
          let f = '';
          if (inD > 0) f += `fade=t=in:st=${s.toFixed(3)}:d=${inD.toFixed(3)}:alpha=1,`;
          if (outD > 0) f += `fade=t=out:st=${Math.max(0, e - outD).toFixed(3)}:d=${outD.toFixed(3)}:alpha=1,`;
          inputArgs.push('-loop', '1', '-t', DUR.toFixed(3), '-i', pngPath);
          filterParts.push(`[${idx}:v]${f ? f.slice(0, -1) : 'null'}[ovin${j}]`);
          filterParts.push(`[${prevV}][ovin${j}]overlay=0:0:enable='gte(t\\,${s.toFixed(3)})*lt(t\\,${e.toFixed(3)})'[ov${j}]`);
        } else {
          inputArgs.push('-i', pngPath);
          filterParts.push(`[${prevV}][${idx}:v]overlay=0:0:enable='gte(t\\,${s.toFixed(3)})*lt(t\\,${e.toFixed(3)})'[ov${j}]`);
        }
        prevV = `ov${j}`;
      }
    }

    filterParts.push(`[${prevV}]format=yuv420p[vout]`);

    // 音声トラックのクリップを base 音声へミックス
    let audioOut = 'basea';
    const audioClips = payload.audioClips || [];
    if (audioClips.length) {
      const aLabels = ['basea'];
      for (let k = 0; k < audioClips.length; k++) {
        const ac = audioClips[k];
        const ms = Math.round(Math.max(0, ac.start) * 1000);
        const vol = ac.volume != null ? ac.volume : 1;
        const adur = Math.max(0, ac.out - ac.in);
        const afi = ac.fadeIn || 0, afo = ac.fadeOut || 0;
        let af = '';
        if (afi > 0) af += `,afade=t=in:st=0:d=${afi.toFixed(3)}`;
        if (afo > 0) af += `,afade=t=out:st=${Math.max(0, adur - afo).toFixed(3)}:d=${afo.toFixed(3)}`;
        const idx = inputIndex++;
        inputArgs.push('-i', ac.path);
        filterParts.push(`[${idx}:a]atrim=start=${ac.in.toFixed(3)}:end=${ac.out.toFixed(3)},asetpts=PTS-STARTPTS${atempoChain(ac.speed || 1)},volume=${vol.toFixed(3)}${af},adelay=${ms}|${ms},${AFMT}[aclip${k}]`);
        aLabels.push(`aclip${k}`);
      }
      filterParts.push(`${aLabels.map((l) => `[${l}]`).join('')}amix=inputs=${aLabels.length}:normalize=0:duration=longest[amixed]`);
      audioOut = 'amixed';
    }

    // 書き出しオプション（形式・品質・範囲・ハードウェアエンコード）
    const opts = payload.options || {};
    const format = opts.format || 'mp4';      // mp4 | webm | mp3
    const quality = opts.quality || 'normal'; // high | normal | light
    const hw = !!opts.hwaccel;
    const range = (opts.range && (opts.range.end - opts.range.start) > 0.05) ? opts.range : null;

    // 範囲書き出し：最終 vout/aout を範囲へトリム
    let vmap = 'vout', amap = audioOut, outDur = DUR;
    if (range) {
      const rs = Math.max(0, range.start), re = Math.min(DUR, range.end);
      filterParts.push(`[vout]trim=start=${rs.toFixed(3)}:end=${re.toFixed(3)},setpts=PTS-STARTPTS[voutR]`);
      filterParts.push(`[${audioOut}]atrim=start=${rs.toFixed(3)}:end=${re.toFixed(3)},asetpts=PTS-STARTPTS[aoutR]`);
      vmap = 'voutR'; amap = 'aoutR'; outDur = re - rs;
    }

    // 音声のみ出力では映像出力が未接続になるため nullsink で消費する
    if (format === 'mp3') filterParts.push(`[${vmap}]nullsink`);

    const totalDuration = outDur;
    const filterGraph = filterParts.join(';');
    if (process.env.TCE_FILTER_DEBUG) console.error('FILTERGRAPH:\n' + filterGraph.replace(/;/g, ';\n'));

    const crf = { high: '18', normal: '20', light: '26' }[quality] || '20';
    const args = ['-y', '-hide_banner', ...inputArgs, '-filter_complex', filterGraph];
    if (format === 'mp3') {
      args.push('-map', `[${amap}]`, '-c:a', 'libmp3lame', '-q:a', '2', '-t', outDur.toFixed(3), outputPath);
    } else if (format === 'webm') {
      args.push('-map', `[${vmap}]`, '-map', `[${amap}]`, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', crf, '-pix_fmt', 'yuv420p', '-r', String(FPS), '-c:a', 'libopus', '-b:a', '160k', '-t', outDur.toFixed(3), outputPath);
    } else {
      const vcodec = hw ? 'h264_videotoolbox' : 'libx264';
      args.push('-map', `[${vmap}]`, '-map', `[${amap}]`, '-c:v', vcodec);
      if (hw) args.push('-b:v', ({ high: '12M', normal: '8M', light: '4M' }[quality] || '8M'));
      else args.push('-preset', 'medium', '-crf', crf);
      args.push('-pix_fmt', 'yuv420p', '-r', String(FPS), '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-t', outDur.toFixed(3), outputPath);
    }

    if (onProgress) onProgress(0, '書き出しを開始しています…');

    const result = await new Promise((resolve) => {
      let stderr = '';
      let proc;
      try {
        proc = spawn(FFMPEG, args, { windowsHide: true });
      } catch (err) {
        resolve({ code: -1, stderr: String(err && err.message || err) });
        return;
      }
      if (registerProc) registerProc(proc);
      proc.stderr.on('data', (d) => {
        const s = d.toString();
        stderr += s;
        // 進捗（time=00:00:12.34 を解析）
        const m = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(s);
        if (m && totalDuration > 0 && onProgress) {
          const cur = (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
          const ratio = Math.min(0.999, cur / totalDuration);
          onProgress(ratio, `書き出し中… ${Math.round(ratio * 100)}%`);
        }
      });
      proc.on('error', (err) => resolve({ code: -1, stderr: stderr + '\n' + String(err && err.message || err) }));
      proc.on('close', (code) => resolve({ code, stderr }));
    });

    if (result.code === 0) {
      if (onProgress) onProgress(1, '完了');
      cleanup();
      return { ok: true, outputPath };
    }

    cleanup();
    if (result.canceled) return { ok: false, canceled: true };
    // stderr の末尾のみ返す（長すぎるため）
    const tail = (result.stderr || '').split('\n').slice(-12).join('\n');
    return { ok: false, error: `FFmpeg がエラーを返しました (code ${result.code})。\n${tail}` };
  } catch (err) {
    cleanup();
    return { ok: false, error: String(err && err.stack || err) };
  }
}

// 低解像度プロキシを生成（プレビュー高速化用）。素材＋サイズ＋更新時刻でキャッシュ。
const PROXY_DIR = path.join(os.tmpdir(), 'telora-proxies');
async function makeProxy(srcPath) {
  try {
    if (!fs.existsSync(PROXY_DIR)) fs.mkdirSync(PROXY_DIR, { recursive: true });
    const st = fs.statSync(srcPath);
    const key = crypto.createHash('md5').update(`${srcPath}:${st.size}:${st.mtimeMs}`).digest('hex').slice(0, 16);
    const out = path.join(PROXY_DIR, `${key}.mp4`);
    if (fs.existsSync(out)) return { ok: true, proxyPath: out, cached: true };
    const r = await run(FFMPEG, ['-y', '-i', srcPath, '-vf', 'scale=-2:480', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-c:a', 'aac', '-b:a', '128k', out]);
    if (r.code === 0 && fs.existsSync(out)) return { ok: true, proxyPath: out };
    return { ok: false, error: (r.stderr || '').split('\n').filter(Boolean).slice(-3).join('\n') };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
}

// 文字起こし用に音声を抽出/ミックスして 16kHz mono wav を作る。
// segments: [{ path, in, out, start, volume }]（start=タイムライン上の開始秒）。1本ならそのまま、複数なら adelay+amix。
async function extractAudio(segments, duration) {
  try {
    if (!segments || !segments.length) return { ok: false, error: '対象の音声がありません' };
    const out = path.join(os.tmpdir(), `telora-stt-${Date.now()}.wav`);
    const inputArgs = []; const parts = []; const labels = [];
    segments.forEach((s, i) => {
      inputArgs.push('-i', s.path);
      const ms = Math.round(Math.max(0, s.start || 0) * 1000);
      const vin = (s.in != null ? s.in : 0).toFixed(3);
      const vout = (s.out != null ? s.out : 0).toFixed(3);
      const vol = (s.volume != null ? s.volume : 1).toFixed(3);
      parts.push(`[${i}:a]atrim=start=${vin}:end=${vout},asetpts=PTS-STARTPTS,volume=${vol},adelay=${ms}|${ms},aformat=sample_fmts=s16:sample_rates=16000:channel_layouts=mono[a${i}]`);
      labels.push(`[a${i}]`);
    });
    let aout;
    if (segments.length === 1) aout = 'a0';
    else { parts.push(`${labels.join('')}amix=inputs=${labels.length}:normalize=0:duration=longest[mix]`); aout = 'mix'; }
    const args = ['-y', '-hide_banner', ...inputArgs, '-filter_complex', parts.join(';'), '-map', `[${aout}]`, '-ac', '1', '-ar', '16000'];
    if (duration && duration > 0) args.push('-t', duration.toFixed(3));
    args.push(out);
    const r = await run(FFMPEG, args);
    if (r.code === 0 && fs.existsSync(out)) return { ok: true, path: out };
    return { ok: false, error: (r.stderr || '').split('\n').filter(Boolean).slice(-3).join('\n') };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
}

module.exports = { checkTools, probe, exportTimeline, extractFrame, makeProxy, extractAudio, FFMPEG, FFPROBE };
