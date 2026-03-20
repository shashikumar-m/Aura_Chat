// generate-icons.js
// Place this in S:\project2\chating_clone\
// Run: node generate-icons.js

const { createCanvas } = require('canvas');
const fs   = require('fs');
const path = require('path');

const SIZES  = [72, 96, 128, 144, 152, 192, 384, 512];
const outDir = path.join(__dirname, 'public', 'icons');

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
  console.log('Created public/icons/');
}

function drawIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx    = canvas.getContext('2d');
  const r      = size * 0.22;

  const grad = ctx.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, '#5b6af7');
  grad.addColorStop(1, '#a78bfa');

  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(size - r, 0);
  ctx.quadraticCurveTo(size, 0, size, r);
  ctx.lineTo(size, size - r);
  ctx.quadraticCurveTo(size, size, size - r, size);
  ctx.lineTo(r, size);
  ctx.quadraticCurveTo(0, size, 0, size - r);
  ctx.lineTo(0, r);
  ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  const cx = size / 2;
  const cy = size * 0.46;
  const bw = size * 0.52;
  const bh = size * 0.38;
  const br = size * 0.09;

  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.beginPath();
  ctx.moveTo(cx - bw/2 + br, cy - bh/2);
  ctx.lineTo(cx + bw/2 - br, cy - bh/2);
  ctx.quadraticCurveTo(cx + bw/2, cy - bh/2, cx + bw/2, cy - bh/2 + br);
  ctx.lineTo(cx + bw/2, cy + bh/2 - br);
  ctx.quadraticCurveTo(cx + bw/2, cy + bh/2, cx + bw/2 - br, cy + bh/2);
  ctx.lineTo(cx - bw/2 + size*0.13, cy + bh/2);
  ctx.lineTo(cx - bw/2, cy + bh/2 + size*0.13);
  ctx.lineTo(cx - bw/2, cy + bh/2 - br);
  ctx.quadraticCurveTo(cx - bw/2, cy + bh/2, cx - bw/2 + br, cy + bh/2);
  ctx.lineTo(cx - bw/2 + br, cy - bh/2 + br);
  ctx.quadraticCurveTo(cx - bw/2, cy - bh/2 + br, cx - bw/2, cy - bh/2);
  ctx.closePath();
  ctx.fill();

  const dotR   = size * 0.042;
  const dotGap = size * 0.11;
  ctx.fillStyle = '#5b6af7';
  [-1, 0, 1].forEach(i => {
    ctx.beginPath();
    ctx.arc(cx + i * dotGap, cy, dotR, 0, Math.PI * 2);
    ctx.fill();
  });

  return canvas.toBuffer('image/png');
}

console.log('\nGenerating Aura Chat icons...\n');
SIZES.forEach(size => {
  try {
    const buf  = drawIcon(size);
    const file = path.join(outDir, `icon-${size}.png`);
    fs.writeFileSync(file, buf);
    console.log('  OK icon-' + size + '.png');
  } catch (err) {
    console.error('  FAIL icon-' + size + '.png:', err.message);
  }
});
console.log('\nDone! All icons saved to public/icons/');