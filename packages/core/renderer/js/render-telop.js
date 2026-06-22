// テロップ描画（プレビューと書き出しで共通使用）
// frameW/frameH は出力解像度。位置・サイズは解像度非依存で保持する。

function hexToRgba(hex, alpha) {
  let h = (hex || '#000000').replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const r = parseInt(h.slice(0, 2), 16) || 0;
  const g = parseInt(h.slice(2, 4), 16) || 0;
  const b = parseInt(h.slice(4, 6), 16) || 0;
  return `rgba(${r},${g},${b},${alpha})`;
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * テロップを 1 つ描画する。
 * 戻り値: フレーム座標系での外接矩形 { x, y, w, h }（当たり判定に使用）。
 */
export function drawTelop(ctx, telop, frameW, frameH, reveal = 1) {
  const fontPx = Math.max(4, telop.size * frameH);
  const lineHeight = fontPx * 1.3;
  const fullText = String(telop.text || '');
  const lines = fullText.split('\n');
  if (lines.length === 0) lines.push('');
  // タイプライター：表示文字数を reveal で制限（測定は全文、描画は先頭から）
  let drawLines = lines;
  if (reveal < 1) {
    let shown = Math.floor(reveal * fullText.replace(/\n/g, '').length);
    drawLines = lines.map((ln) => { const take = Math.max(0, Math.min(ln.length, shown)); shown -= ln.length; return ln.slice(0, take); });
  }

  const weight = telop.bold ? '800' : '400';
  const style = telop.italic ? 'italic ' : '';
  ctx.font = `${style}${weight} ${fontPx}px ${telop.fontFamily || 'sans-serif'}`;
  ctx.textBaseline = 'middle';
  const shadowOn = telop.shadow !== false;

  // 各行の幅を測定
  let blockW = 0;
  const widths = lines.map((ln) => {
    const w = ctx.measureText(ln || ' ').width;
    if (w > blockW) blockW = w;
    return w;
  });
  const blockH = lines.length * lineHeight;

  const cx = telop.x * frameW;
  const cy = telop.y * frameH;
  const top = cy - blockH / 2;
  const padX = fontPx * 0.4;
  const padY = fontPx * 0.26;

  const bbox = {
    x: cx - blockW / 2 - padX,
    y: top - padY,
    w: blockW + padX * 2,
    h: blockH + padY * 2,
  };

  // 背景
  if (telop.bg) {
    ctx.fillStyle = hexToRgba(telop.bgColor, telop.bgOpacity != null ? telop.bgOpacity : 0.45);
    roundRect(ctx, bbox.x, bbox.y, bbox.w, bbox.h, fontPx * 0.18);
    ctx.fill();
  }

  // 文字
  const ow = telop.outline ? Math.max(1, (telop.outlineWidth || 0.07) * fontPx) : 0;
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;

  for (let i = 0; i < lines.length; i++) {
    const lineY = top + i * lineHeight + lineHeight / 2;
    const txt = drawLines[i];
    if (!txt) continue;
    let x;
    if (telop.align === 'left') { ctx.textAlign = 'left'; x = cx - blockW / 2; }
    else if (telop.align === 'right') { ctx.textAlign = 'right'; x = cx + blockW / 2; }
    else { ctx.textAlign = 'center'; x = cx; }

    // ドロップシャドウ（テキストの輪郭シルエットに対して 1 回だけ落とす）
    if (shadowOn) {
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = fontPx * 0.18;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = fontPx * 0.06;
      if (ow > 0) { ctx.lineWidth = ow; ctx.strokeStyle = telop.outlineColor || '#000000'; ctx.strokeText(txt, x, lineY); }
      else { ctx.fillStyle = telop.color || '#ffffff'; ctx.fillText(txt, x, lineY); }
      ctx.restore();
    }
    // フチ（くっきり）
    if (ow > 0) {
      ctx.lineWidth = ow;
      ctx.strokeStyle = telop.outlineColor || '#000000';
      ctx.strokeText(txt, x, lineY);
    }
    // 本体
    ctx.fillStyle = telop.color || '#ffffff';
    ctx.fillText(txt, x, lineY);
  }

  return bbox;
}

/**
 * 指定時刻 t に表示されるテロップをすべて描画し、
 * 当たり判定用に { telop, bbox } の配列を返す。
 */
export function drawTelopsAt(ctx, telops, t, frameW, frameH) {
  ctx.clearRect(0, 0, frameW, frameH);
  const boxes = [];
  for (const tp of telops) {
    if (t >= tp.start - 1e-6 && t < tp.end + 1e-6) {
      const bbox = drawTelop(ctx, tp, frameW, frameH);
      boxes.push({ telop: tp, bbox });
    }
  }
  return boxes;
}

/**
 * 1 つのテロップを出力解像度のフルフレーム透過 PNG (dataURL) として描画する。
 * 書き出し時に FFmpeg の overlay 入力として使用。
 */
export function renderTelopPng(telop, frameW, frameH, opacity = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = frameW;
  canvas.height = frameH;
  const ctx = canvas.getContext('2d');
  if (opacity < 1) ctx.globalAlpha = Math.max(0, opacity);
  drawTelop(ctx, telop, frameW, frameH);
  return canvas.toDataURL('image/png');
}
