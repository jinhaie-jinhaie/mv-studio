// 空镜/B-roll：文生图 → LTX 图生视频 4 秒，用于 MV 剪辑穿插，打散主镜重复感。
// 用法：node tools/make_broll.mjs [name]   （name 为空则跑全部）
import fs from 'node:fs';
import path from 'node:path';
import { getSettings } from '../server/db.js';
import { buildTxt2Img, buildLtxImg2Video, ltxFramesForSeconds } from '../server/workflows.js';
import { submit, waitFor, download, uploadImage, outputDir } from '../server/comfy.js';

const settings = getSettings();
const OUT = path.join(import.meta.dirname, '..', 'output', '_mvsing');
fs.mkdirSync(OUT, { recursive: true });

const COMMON = '同一间小酒馆，同一片暖黄灯串木墙背景，现实主义电影感，暖黄调，浅景深，35mm 镜头，轻微颗粒，竖构图，整张图是完整照片，单一连续场景，画面干净，没有文字水印字幕';

const SHOTS = [
  {
    name: 'broll1',
    seed: 880101,
    img: [
      '小酒馆靠窗的一角，窗外是深夜街道的虚焦灯光，窗玻璃上有几串暖黄灯串的倒影',
      '画面里没有人物，只有一张空的高脚凳和它旁边立着的麦克风支架，金属杆上有一道暖光高光',
      '桌面上留着一杯喝了一半的酒，杯壁有水汽，背景虚化',
      COMMON,
    ].join('，'),
    vid: 'empty bar corner by the window, string lights glowing, slow gentle camera push in, dust motes in warm light, no people, cinematic, realistic',
  },
  {
    name: 'broll2',
    seed: 880202,
    img: [
      '吧台上的一只矮酒杯特写，杯中有半杯琥珀色的酒，杯沿反着暖黄的灯串光点',
      '杯旁放着一部手机，屏幕朝下，背景是一整片虚掉的灯串光斑',
      '稍有前景虚化，极浅景深，低角度平视',
      COMMON,
    ].join('，'),
    vid: 'close up of a glass of amber drink on a bar counter, bokeh light points drifting, slow rack focus, condensation on the glass, cinematic, realistic',
  },
  {
    name: 'broll3',
    seed: 880303,
    img: [
      '小酒馆暗处的几个听众，只有轮廓和侧逆光，能看到三四个人坐在桌边安静听歌',
      '最近的一位只拍到肩膀和后脑，边缘被灯串的暖光勾出一圈轮廓光',
      '背景还是那面木墙和灯串，人物都是虚焦剪影，不看清五官',
      COMMON,
    ].join('，'),
    vid: 'audience silhouettes in a dim bar listening quietly, rim light on shoulders, slow drift, bokeh, cinematic, realistic',
  },
];

const only = process.argv[2];
const list = only ? SHOTS.filter((s) => s.name === only) : SHOTS;
if (!list.length) {
  console.error('unknown shot', only);
  process.exit(1);
}

const done = [];
for (const shot of list) {
  console.log(`\n=== ${shot.name} ===`);
  console.log('出首帧图…');
  const imgWf = buildTxt2Img({
    settings,
    prompt: shot.img,
    width: 768,
    height: 1344,
    seed: shot.seed,
    prefix: `studio/${shot.name}_frame`,
  });
  const imgFiles = await waitFor(settings.comfyUrl, await submit(settings.comfyUrl, imgWf), {
    timeoutMs: 900000,
  });
  const imgRel = await download(settings.comfyUrl, imgFiles[0], '_mvsing');
  const imgAbs = path.join(outputDir, path.relative('/output', imgRel));

  const imageName = await uploadImage(settings.comfyUrl, imgAbs, `${shot.name}_first.png`);
  const frames = ltxFramesForSeconds(4);
  console.log(`出视频：768x1344 / ${frames} 帧 / 8 步…`);
  const vidWf = buildLtxImg2Video({
    settings,
    prompt: shot.vid,
    imageName,
    width: 768,
    height: 1344,
    frames,
    steps: 8,
    fps: 24,
    seed: shot.seed,
    prefix: `studio/${shot.name}`,
  });
  const vidFiles = await waitFor(settings.comfyUrl, await submit(settings.comfyUrl, vidWf), {
    timeoutMs: 3600000,
  });
  const vidRel = await download(settings.comfyUrl, vidFiles[0], '_mvsing');
  const vidAbs = path.join(outputDir, path.relative('/output', vidRel));
  console.log('视频', vidAbs);
  done.push({ name: shot.name, seed: shot.seed, imgAbs, vidAbs });
}

const outFile = path.join(OUT, 'last_broll.json');
fs.writeFileSync(outFile, JSON.stringify(done, null, 2), 'utf-8');
console.log('OK', outFile);
