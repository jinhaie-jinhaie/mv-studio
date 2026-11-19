// 唱歌镜头：文生图（女歌手对镜开口唱）→ LTX 图生视频 4 秒 → 输出可对口型的源片。
// 用法：node tools/make_singing_shot.mjs [seed]
import fs from 'node:fs';
import path from 'node:path';
import { getSettings } from '../server/db.js';
import { buildTxt2Img, buildLtxImg2Video, ltxFramesForSeconds } from '../server/workflows.js';
import { submit, waitFor, download, uploadImage, outputDir } from '../server/comfy.js';

const settings = getSettings();
const OUT = path.join(import.meta.dirname, '..', 'output', '_mvsing');
fs.mkdirSync(OUT, { recursive: true });
const seed = Number(process.argv[2] || 880011);

const IMG_PROMPT = [
  '一个二十七八岁的东亚女人，坐在小酒馆靠窗的高脚凳上，正对着镜头唱歌',
  '只到胸口的半身中景，脸占画面三分之一，正面偏一点点角度，眼睛看镜头，嘴巴半张正在唱出一个音',
  '深色针织衫，头发随意扎在脑后，几缕碎发，手里握着一支立式麦克风，靠得很近',
  '背景是虚掉的暖黄灯串和木墙，前景有一小片暗色吧台',
  '现实主义电影感，暖黄调，浅景深，35mm 镜头，轻微颗粒，竖构图',
  '整张图是一张完整的照片，单一连续场景，画面干净，没有文字、水印、字幕',
].join('，');

const VID_PROMPT =
  'the woman sings into the microphone, lips moving in a natural singing rhythm, head tilts slightly, shoulders sway gently, warm string lights bokeh in the background, slow subtle camera push in, cinematic, realistic';

console.log('出首帧图…');
const imgWf = buildTxt2Img({
  settings,
  prompt: IMG_PROMPT,
  width: 768,
  height: 1344,
  seed,
  prefix: 'studio/sing_frame',
});
const imgFiles = await waitFor(settings.comfyUrl, await submit(settings.comfyUrl, imgWf), {
  timeoutMs: 900000,
});
const imgRel = await download(settings.comfyUrl, imgFiles[0], '_mvsing');
const imgAbs = path.join(outputDir, path.relative('/output', imgRel));
console.log('首帧图', imgAbs);

const imageName = await uploadImage(settings.comfyUrl, imgAbs, 'singshot_first.png');
console.log('已上传 input:', imageName);

const frames = ltxFramesForSeconds(4);
console.log(`出视频：768x1344 / ${frames} 帧 / 8 步…`);
const vidWf = buildLtxImg2Video({
  settings,
  prompt: VID_PROMPT,
  imageName,
  width: 768,
  height: 1344,
  frames,
  steps: 8,
  fps: 24,
  seed,
  prefix: 'studio/sing_shot',
});
const vidFiles = await waitFor(settings.comfyUrl, await submit(settings.comfyUrl, vidWf), {
  timeoutMs: 3600000,
});
const vidRel = await download(settings.comfyUrl, vidFiles[0], '_mvsing');
const vidAbs = path.join(outputDir, path.relative('/output', vidRel));
console.log('视频', vidAbs);

fs.writeFileSync(
  path.join(OUT, 'last_sing.json'),
  JSON.stringify({ seed, imgPrompt: IMG_PROMPT, vidPrompt: VID_PROMPT, imgAbs, vidAbs }, null, 2),
  'utf-8',
);
console.log('OK');
