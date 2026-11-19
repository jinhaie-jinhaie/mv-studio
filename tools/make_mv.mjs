// 一句灵感 → 歌 → MV：歌词/出歌/出图/动效拼接，全本地。
// 用法：node tools/make_mv.mjs "一句灵感"
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getSettings } from '../server/db.js';
import { buildMusic, buildTxt2Img } from '../server/workflows.js';
import { submit, waitFor, download } from '../server/comfy.js';
import { resolveFfmpeg } from '../server/assemble.js';

const exec = promisify(execFile);
const settings = getSettings();
const IDEA = process.argv[2] || '夜里三点半，便利店还亮着灯，一个加班的女孩遇到十年前失踪的自己';
const OUT_ROOT = path.join(import.meta.dirname, '..', 'output');

function slugify(s) {
  return Buffer.from(s).toString('hex').slice(0, 12);
}

function extractJson(text) {
  const raw = String(text ?? '').replace(/```json/gi, '```').replace(/```/g, '');
  const a = raw.indexOf('{');
  const b = raw.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('LLM 没返回 JSON：' + raw.slice(0, 300));
  return JSON.parse(raw.slice(a, b + 1));
}

async function llm(system, user) {
  const base = String(settings.ollamaUrl || 'http://127.0.0.1:11434').replace(/\/+$/, '');
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: settings.llmModel,
      stream: false,
      options: { temperature: 0.75, num_ctx: 8192, repeat_penalty: 1.1 },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`ollama ${res.status}`);
  const j = await res.json();
  return j.message?.content ?? '';
}

const WRITE_SYSTEM = `你是给短视频写歌的词作者。根据用户给的一句灵感，写一首 30 秒的中文歌，并给出每个画面的描述。
硬规则：
1. 歌词 6 行，每行不超过 14 个字，是人真会说的话，口语，不要格言体、不要广告腔、不要"人生感悟"。
2. 6 行要有一个小转折：前 3 行铺一个场景，第 4 行出现一个意外或对比，后 2 行收住。
3. 每行配一个画面描述 visual：中景或中全景，只写看得见的东西（地点、这个人正在做什么、环境、光），不写情绪形容词，不写台词，不写文字。
4. 全片同一个人物、同一个地点、同一个光源。人物用一句固定描述，每行 visual 里都带上，保证前后是一个人。
5. 音乐用英文标签描述风格、人声、配器，适合 ACE-Step。
只输出 JSON，不要任何解释：
{"title":"不超过8字","tags":"英文音乐标签，逗号分隔","bpm":88,"keyscale":"A minor","character":"人物固定描述（年龄/发型/衣着）","place":"地点固定描述","lines":[{"text":"第一行歌词","visual":"这一行的画面"}]}`;

async function main() {
  const slug = slugify(IDEA);
  const dir = path.join(OUT_ROOT, `mv_${slug}`);
  fs.mkdirSync(dir, { recursive: true });
  const t0 = Date.now();
  const log = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${m}`);

  // 1. 写词
  log('写歌词…');
  const song = extractJson(await llm(WRITE_SYSTEM, `灵感：${IDEA}\n画面风格：现实主义电影感，暖黄调，浅景深\n请输出 JSON。`));
  const lines = (song.lines || []).slice(0, 6);
  if (lines.length < 3) throw new Error('歌词行数不足');
  log(`歌名《${song.title}》 ${lines.length} 行`);

  // 2. 出歌
  const lyricText = `[verse]\n${lines.slice(0, 3).map((l) => l.text).join('\n')}\n[chorus]\n${lines.slice(3).map((l) => l.text).join('\n')}`;
  const seed = Math.floor(Math.random() * 2 ** 31);
  log('ACE-Step 出歌…');
  const musicWf = buildMusic({
    settings,
    tags: song.tags || 'acoustic folk, warm female vocal, soft guitar, intimate',
    lyrics: lyricText,
    bpm: Number(song.bpm) || 88,
    seconds: 30,
    language: 'zh',
    keyscale: song.keyscale || 'A minor',
    seed,
    prefix: `studio/mv_${slug}`,
  });
  const musicUrl = await download(settings.comfyUrl, (await waitFor(settings.comfyUrl, await submit(settings.comfyUrl, musicWf)))[0], `mv_${slug}`);
  const songFile = path.join(OUT_ROOT, `mv_${slug}`, path.basename(musicUrl));
  log(`歌好了 ${path.basename(songFile)}`);

  // 3. 逐行出图
  const styleAnchor = '现实主义电影感，自然光，暖黄调，浅景深，颗粒质感，竖构图';
  const imgs = [];
  for (let i = 0; i < lines.length; i += 1) {
    const l = lines[i];
    const prompt = [
      l.visual,
      `同一个人物：${song.character || '三十岁上下的普通女人，短头发，深色外套'}`,
      `同一个地点：${song.place || '深夜的便利店门口'}`,
      styleAnchor,
      '整张图是一张完整的竖构图照片，单一连续场景，中景或中全景，人物占画面约一半，头顶留出空间，人物站在画面中间不贴画框边缘，表情平静；画面干净，没有文字、水印、字幕',
    ].join('，');
    log(`出图 ${i + 1}/${lines.length}…`);
    const wf = buildTxt2Img({
      settings,
      prompt,
      width: 768,
      height: 1344,
      seed: 500000 + i * 137,
      prefix: `studio/mv_${slug}_shot${i + 1}`,
    });
    const u = await download(settings.comfyUrl, (await waitFor(settings.comfyUrl, await submit(settings.comfyUrl, wf)))[0], `mv_${slug}`);
    imgs.push(path.join(OUT_ROOT, `mv_${slug}`, path.basename(u)));
  }
  log(`图齐了 ${imgs.length} 张`);

  // 4. 动效拼接
  const ffmpeg = resolveFfmpeg(settings);
  const segDir = path.join(dir, 'seg');
  fs.mkdirSync(segDir, { recursive: true });
  const per = 30 / lines.length; // 每句的时长
  const segs = [];
  for (let i = 0; i < imgs.length; i += 1) {
    const seg = path.join(segDir, `s${i}.mp4`);
    log(`做动效 ${i + 1}/${imgs.length}（${per.toFixed(1)}s）…`);
    await exec(
      ffmpeg,
      [
        '-y', '-loop', '1', '-i', imgs[i],
        '-t', per.toFixed(2),
        '-vf',
        "scale=1440:2560,zoompan=z='min(zoom+0.0006,1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=180:s=720x1280:fps=30",
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30',
        seg,
      ],
      { windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
    );
    segs.push(seg);
  }

  const listFile = path.join(dir, 'list.txt');
  fs.writeFileSync(listFile, segs.map((s) => `file '${s.replace(/\\/g, '/')}'`).join('\n'), 'utf-8');
  const merged = path.join(dir, 'merged.mp4');
  await exec(ffmpeg, ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', merged], { windowsHide: true });

  // 5. 贴整首歌
  const finalFile = path.join(OUT_ROOT, `mv_${slug}`, `${song.title || 'MV'}.mp4`);
  log('贴歌…');
  await exec(
    ffmpeg,
    [
      '-y', '-i', merged, '-i', songFile,
      '-map', '0:v:0', '-map', '1:a:0',
      '-c:v', 'copy', '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '192k',
      '-shortest',
      finalFile,
    ],
    { windowsHide: true },
  );

  const meta = { idea: IDEA, song: { ...song, lyrics: lyricText }, songFile, images: imgs, mv: finalFile, dir };
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8');
  log(`完成 ${finalFile}`);
  console.log(JSON.stringify({ title: song.title, mv: finalFile, dir, lines: lines.map((l) => l.text) }, null, 2));
}

main().catch((e) => {
  console.error('MV 失败：', e.message);
  process.exit(1);
});
