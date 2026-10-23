// Cuts the recorded demo (scripts/video/record-demo.mjs) into a captioned video under 115 s with ffmpeg, following
// submission/DEMO_SCRIPT_EN.md. Every segment is real footage at its real pace; captions are burned in; no music.
// Usage: node scripts/video/build-video.mjs   → video-output/the-12th-man-demo.mp4
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');
const out = join(root, 'video-output');
const { markers, frames } = JSON.parse(readFileSync(join(out, 'markers.json'), 'utf8'));
const at = name => markers.find(m => m.name === name)?.t;
const font = ['C:/Windows/Fonts/bahnschrift.ttf', 'C:/Windows/Fonts/segoeui.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'].find(f => existsSync(f));
if (!font) throw new Error('no font for captions');
copyFileSync(font, join(out, 'font.ttf'));
const ffmpeg = args => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { cwd: out, stdio: 'inherit' });
const MAX_TOTAL = 115;

/** One segment from real frames between two wall times, with a caption. */
function clip(n, from, to, caption) {
  if (from === undefined || to === undefined || to <= from) throw new Error(`segment ${n}: missing markers`);
  const range = frames.filter(f => f.t >= from && f.t <= to);
  if (range.length < 2) throw new Error(`segment ${n}: no frames between markers`);
  const lines = [];
  range.forEach((f, i) => {
    const next = range[i + 1]?.t ?? to;
    lines.push(`file 'frames/${f.file}'`, `duration ${Math.max(0.001, Math.min(0.5, next - f.t)).toFixed(3)}`);
  });
  lines.push(`file 'frames/${range[range.length - 1].file}'`);
  writeFileSync(join(out, `seg${n}.txt`), lines.join('\n'));
  writeFileSync(join(out, `cap${n}.txt`), caption);
  ffmpeg(['-f', 'concat', '-safe', '0', '-i', `seg${n}.txt`, '-vf', `fps=30,scale=1600:900,${captionFilter(n)}`, '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', '30', `seg${n}.mp4`]);
  return Math.min(to - from, 999);
}

function captionFilter(n) {
  return `drawtext=fontfile=font.ttf:textfile=cap${n}.txt:fontcolor=white:fontsize=27:line_spacing=6:box=1:boxcolor=0x060b16@0.78:boxborderw=16:x=(w-text_w)/2:y=h-text_h-34`;
}

/** A title or end card: a still of the stadium, darkened, with large text. */
function card(n, still, seconds, title, sub, size = 92) {
  writeFileSync(join(out, `title${n}.txt`), title);
  writeFileSync(join(out, `sub${n}.txt`), sub);
  ffmpeg(['-loop', '1', '-t', String(seconds), '-i', `frames/${still}`, '-vf',
    `scale=1600:900,boxblur=6:2,drawbox=x=0:y=0:w=iw:h=ih:color=0x060b16@0.62:t=fill,drawtext=fontfile=font.ttf:textfile=title${n}.txt:fontcolor=white:fontsize=${size}:x=(w-text_w)/2:y=h/2-130,drawtext=fontfile=font.ttf:textfile=sub${n}.txt:fontcolor=0xff8a2a:fontsize=32:line_spacing=10:x=(w-text_w)/2:y=h/2+10,fps=30`,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', '30', `seg${n}.mp4`]);
  return seconds;
}

const start = at('start'), kickoff = at('kickoff'), m1 = at('moment-1'), d1 = at('decision-1'), analyst = at('analyst'), goal = at('insight-goal'), m3 = at('moment-3'), result = at('result');
const segments = [];
const stillStart = frames.find(f => f.t >= start + 0.5).file;
segments.push(card(1, stillStart, 6, 'THE 12TH MAN', 'Coach the moments that matter.\nExplainable match intelligence from synthetic football.'));
segments.push(clip(2, start + 0.3, Math.min(kickoff + 1, start + 10), 'Pick your club, Fan or Analyst view,\nand a player to follow.'));
segments.push(clip(3, kickoff + 4, Math.min(m1 - 0.5, kickoff + 20), '22 autonomous players, real ball physics, an independent referee.\nEvery event is synthetic – and nothing is scripted.'));
segments.push(clip(4, m1 + 1.2, d1 - 0.2, 'The orchestrator stops only at real choices –\nand explains why this one matters.'));
segments.push(clip(5, d1 - 0.2, d1 + 9, 'You decide. The players try.\nThe consequence card shows what really happened.'));
if (analyst) segments.push(clip(6, analyst - 0.5, analyst + 16, 'Analyst mode: pass difficulty, model xG, pressure –\nevery insight cites the events it rests on.'));
const big = goal ?? m3;
if (big) segments.push(clip(7, Math.max(d1 + 9, big - 6), big + 4, goal ? 'Every goal is explained: where the move began,\nthe passes, the shot.' : 'Another decision, explained from the frozen frame.'));
segments.push(clip(8, result + 0.5, Math.min(at('end') ?? result + 14, result + 14), 'Automated match report –\nand the whole intelligence as a timed JSON feed.'));
segments.push(card(9, stillStart, 7, 'Ingest · Interpret · Explain · Render · Personalize', 'Microsoft Foundry narration: prepared – see repository status\ngithub.com/sasaisaschi/football', 54));

const total = segments.reduce((a, s) => a + s, 0);
if (total > MAX_TOTAL) throw new Error(`video would be ${total.toFixed(1)} s, more than ${MAX_TOTAL} s`);
writeFileSync(join(out, 'list.txt'), [1, 2, 3, 4, 5, ...(big && big < (analyst ?? Infinity) ? [7] : []), ...(analyst ? [6] : []), ...(big && big >= (analyst ?? Infinity) ? [7] : []), 8, 9].map(n => `file 'seg${n}.mp4'`).join('\n'));
ffmpeg(['-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', 'the-12th-man-demo.mp4']);
const probe = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', join(out, 'the-12th-man-demo.mp4')]).toString().trim();
console.log(`segments ${segments.length}, planned ${total.toFixed(1)} s, file duration ${Number(probe).toFixed(1)} s → video-output/the-12th-man-demo.mp4`);
