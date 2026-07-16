// EditCommands 回帰テスト（TCE_EVAL 用）。renderer 上で async 実行され、結果が [eval-result] に出る。
// このファイルはテンプレート。run-commands.js が CONFIG マーカーを実設定に置換して tests/.out/ に生成する。
// 過去の書き捨て検証（ROADMAP 記載の 18コマンド all assert）を恒久資産化したもの。
// セクション単位で try/catch し、途中で例外が起きても部分結果を必ず返す。
async () => {
  const CONFIG = /*__CONFIG__*/ {};
  const out = { asserts: [], skipped: [], windowErrors: [] };
  const A = (name, cond, detail) => {
    out.asserts.push({ name, ok: !!cond, detail: cond ? undefined : String(detail || '').slice(0, 400) });
  };
  const sec = async (name, fn) => {
    try { await fn(); } catch (e) { A(name + ' セクション例外', false, (e && e.stack) || e); }
  };

  // ホーム画面を抜けて新規プロジェクトへ
  const homeNew = document.getElementById('homeNew');
  if (homeNew) homeNew.click();

  const EC = await import('./js/commands/edit-commands.js');
  const run = EC.run;
  const timeline = async () => { const r = await run('getTimeline'); return r.ok ? r.result : null; };
  const allClips = async () => { const t = await timeline(); return t ? t.tracks.flatMap((tr) => tr.clips) : []; };
  const sumDur = async () => (await allClips()).reduce((s, c) => s + c.dur, 0);

  let mediaId = null, clipId = null, telopId = null;

  await sec('1) listCommands', async () => {
    const EXPECTED = [
      'getTimeline', 'getTranscript', 'selectClip', 'splitAt', 'cutBefore', 'cutAfter',
      'deleteClip', 'moveClip', 'addTelop', 'setTelop', 'cutSilence', 'cutFillers',
      'setTrackMute', 'addCrossfade', 'importMedia', 'addClip', 'export', 'undo', 'redo',
    ];
    const names = EC.listCommands();
    A('listCommands 完全一致',
      JSON.stringify([...names].sort()) === JSON.stringify([...EXPECTED].sort()),
      'actual: ' + names.join(','));
  });

  await sec('2) importMedia', async () => {
    const imp = await run('importMedia', { paths: [CONFIG.fixture] });
    A('importMedia ok', imp.ok && imp.result.media.length === 1, JSON.stringify(imp));
    if (imp.ok && imp.result.media[0]) {
      mediaId = imp.result.media[0].id;
      A('fixture duration ≈ 6s', Math.abs(imp.result.media[0].duration - 6) < 0.5, 'duration=' + imp.result.media[0].duration);
    }
  });

  await sec('3) addClip', async () => {
    const add = await run('addClip', { mediaId, start: 0 });
    A('addClip ok', add.ok && add.result.clipId, JSON.stringify(add));
    clipId = add.ok ? add.result.clipId : null;
    const clips = await allClips();
    A('getTimeline にクリップ反映', clips.some((c) => c.id === clipId), JSON.stringify(clips.map((c) => c.id)));
  });

  await sec('4) selectClip', async () => {
    const sel = await run('selectClip', { clipId });
    A('selectClip ok', sel.ok && sel.result.selected === clipId, JSON.stringify(sel));
    const selNg = await run('selectClip', { clipId: 'zzz-not-exist' });
    A('selectClip 不在id → 構造化エラー', selNg.ok === false && typeof selNg.error === 'string', JSON.stringify(selNg));
  });

  await sec('5) splitAt', async () => {
    const before = (await allClips()).length;
    const sp = await run('splitAt', { time: 2 });
    const after = (await allClips()).length;
    A('splitAt ok', sp.ok, JSON.stringify(sp));
    A('splitAt でクリップ数 +1', after === before + 1, `before=${before} after=${after}`);
  });

  await sec('6) cutBefore / cutAfter', async () => {
    // どちらも再生位置のクリップをトリムする操作（総尺ではなくクリップ合計尺が減る）
    const s0 = await sumDur();
    const cb = await run('cutBefore', { time: 1 });
    const s1 = await sumDur();
    A('cutBefore ok', cb.ok, JSON.stringify(cb));
    A('cutBefore で合計尺減少', s1 < s0, `s0=${s0} s1=${s1}`);
    const ca = await run('cutAfter', { time: 5 });
    const s2 = await sumDur();
    A('cutAfter ok', ca.ok, JSON.stringify(ca));
    A('cutAfter で合計尺減少', s2 < s1, `s1=${s1} s2=${s2}`);
  });

  await sec('7) moveClip', async () => {
    const clips = await allClips();
    A('moveClip 前提: クリップ存在', clips.length > 0, 'clips empty');
    const target = clips[0];
    if (!target) return;
    const mv = await run('moveClip', { clipId: target.id, start: 10 });
    A('moveClip ok', mv.ok && mv.result.start === 10, JSON.stringify(mv));
    const moved = (await allClips()).find((c) => c.id === target.id);
    A('moveClip 反映', moved && Math.abs(moved.start - 10) < 0.001, JSON.stringify(moved));
    await run('moveClip', { clipId: target.id, start: target.start }); // 戻す

    // PP028回帰: 同トラック内で重ねて移動 → GUI と同じ上書き解決で重複区間が残らない
    const ta = await run('addTelop', { text: '上書きA', start: 20, end: 22 });
    const tb = await run('addTelop', { text: '上書きB', start: 22, end: 24 });
    A('moveClip 上書き前提: telop 2つ', ta.ok && tb.ok, JSON.stringify([ta.error, tb.error]));
    if (ta.ok && tb.ok) {
      const mv2 = await run('moveClip', { clipId: tb.result.clipId, start: 21 });
      A('moveClip 重なり移動 ok', mv2.ok, JSON.stringify(mv2));
      const tl = await timeline();
      let overlap = false;
      for (const tr of tl.tracks) {
        const cs = [...tr.clips].sort((a, b) => a.start - b.start);
        for (let i = 1; i < cs.length; i++) {
          if (cs[i].start < cs[i - 1].start + cs[i - 1].dur - 1e-3) overlap = true;
        }
      }
      A('moveClip 上書き解決で同トラックに重複なし', !overlap, JSON.stringify(tl.tracks.map((t) => t.clips.map((c) => [c.start, c.dur]))));
      // 後片付け（上書き解決でidが変わる可能性があるため位置で回収）
      const tl2 = await timeline();
      for (const tr of tl2.tracks) {
        for (const c of tr.clips) { if (c.start >= 19.9) await run('deleteClip', { clipId: c.id }); }
      }
    }
  });

  await sec('8) addTelop / getTranscript / setTelop', async () => {
    const tp = await run('addTelop', { text: 'テスト字幕', start: 0.5, end: 2.5 });
    A('addTelop ok', tp.ok && tp.result.clipId, JSON.stringify(tp));
    telopId = tp.ok ? tp.result.clipId : null;
    const tr = await run('getTranscript');
    A('getTranscript に cue 反映', tr.ok && tr.result.cues.some((c) => c.id === telopId && c.text === 'テスト字幕'), JSON.stringify(tr));
    const st = await run('setTelop', { clipId: telopId, text: '変更後の字幕' });
    const tr2 = await run('getTranscript');
    A('setTelop ok', st.ok, JSON.stringify(st));
    A('setTelop 反映', tr2.ok && tr2.result.cues.some((c) => c.id === telopId && c.text === '変更後の字幕'), JSON.stringify(tr2));
  });

  await sec('9) setTrackMute', async () => {
    const t = await timeline();
    const trackId = t.tracks[0].id;
    const m1 = await run('setTrackMute', { trackId, muted: true });
    const t1 = await timeline();
    A('setTrackMute true', m1.ok && t1.tracks[0].muted === true, JSON.stringify(m1));
    const m2 = await run('setTrackMute', { trackId, muted: false });
    const t2 = await timeline();
    A('setTrackMute false', m2.ok && t2.tracks[0].muted === false, JSON.stringify(m2));
  });

  await sec('10) addCrossfade', async () => {
    await run('selectClip', { clipId });
    const cf = await run('addCrossfade', { duration: 0.3 });
    A('addCrossfade ok', cf.ok, JSON.stringify(cf));
  });

  await sec('11) deleteClip / undo / redo', async () => {
    const del = await run('deleteClip', { clipId: telopId });
    const tr1 = await run('getTranscript');
    A('deleteClip ok', del.ok, JSON.stringify(del));
    A('deleteClip で cue 消滅', tr1.ok && !tr1.result.cues.some((c) => c.id === telopId), JSON.stringify(tr1));
    const un = await run('undo');
    const tr2 = await run('getTranscript');
    A('undo で cue 復活', un.ok && tr2.ok && tr2.result.cues.some((c) => c.id === telopId), JSON.stringify(tr2));
    const re = await run('redo');
    const tr3 = await run('getTranscript');
    A('redo で cue 再消滅', re.ok && tr3.ok && !tr3.result.cues.some((c) => c.id === telopId), JSON.stringify(tr3));
  });

  await sec('12) エラー経路', async () => {
    const unk = await run('nopeCommand');
    A('未知コマンド → 構造化エラー', unk.ok === false && /unknown command/.test(unk.error), JSON.stringify(unk));
    const cf = await run('cutFillers', {});
    A('cutFillers 引数なし → 構造化エラー', cf.ok === false && typeof cf.error === 'string', JSON.stringify(cf));
    const cs = await run('cutSilence', {});
    A('cutSilence 引数なし → 構造化エラー', cs.ok === false && typeof cs.error === 'string', JSON.stringify(cs));
  });

  if (CONFIG.fast) {
    out.skipped.push('cutSilence(実FFmpeg)', 'export(実FFmpeg)');
  } else {
    await sec('13) cutSilence / export（実FFmpeg）', async () => {
      // 無音カット: フィクスチャは 0-1s / 3-6s が無音 → made>=1 を決定的に検証
      const add2 = await run('addClip', { mediaId, start: 20 });
      A('addClip(2本目) ok', add2.ok && add2.result.clipId, JSON.stringify(add2));
      const cs = await run('cutSilence', { clipId: add2.result.clipId });
      A('cutSilence made>=1', cs.ok && cs.result && (cs.result.made >= 1), JSON.stringify(cs));
      // 書き出し: 実FFmpeg で MP4 生成（ファイルサイズは runner 側で検証）
      const ex = await run('export', { outputPath: CONFIG.outPath });
      A('export ok', ex.ok && ex.result && ex.result.outputPath === CONFIG.outPath, JSON.stringify(ex));
    });
  }

  if (CONFIG.stt) {
    await sec('14) cutFillers（whisper 実走）', async () => {
      const stt = await window.api.detectStt();
      if (stt && stt.available) {
        const clips = await allClips();
        const video = clips.find((c) => c.kind === 'video');
        const cf = await run('cutFillers', { clipId: video ? video.id : clipId });
        A('cutFillers 構造化結果', cf && typeof cf.ok === 'boolean', JSON.stringify(cf));
      } else {
        out.skipped.push('cutFillers(whisper 実走: エンジン未検出)');
      }
    });
  } else {
    out.skipped.push('cutFillers(whisper 実走)');
  }

  out.windowErrors = window.__errors || [];
  out.total = out.asserts.length;
  out.failed = out.asserts.filter((a) => !a.ok).length;
  return out;
}
