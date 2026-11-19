// HeartMuLa 出歌（第二套可商用模型）：同歌词、同风格，60 秒。
import fs from 'node:fs';
import path from 'node:path';
import { getSettings } from '../server/db.js';
import { buildHeartMuLa } from '../server/workflows.js';
import { submit, waitFor, download } from '../server/comfy.js';
import { execFileSync } from 'node:child_process';

const settings = getSettings();
const OUT = path.join(import.meta.dirname, '..', 'output', '_songhm');
fs.mkdirSync(OUT, { recursive: true });

const tags = 'chinese pop ballad, female vocal, clear pronunciation, close mic intimate singing, acoustic guitar, soft strings, 66 bpm, minimal drums, dry studio mix, no instrumental intro';

const lyrics = `[Verse]
凌晨三点 便利店还亮着灯
我对着报表 发呆
窗外的风 把传单吹得乱转
[Chorus]
抬头看见 十年前的自己
她问我 你还好吗
我说还行 就是有点累
[Verse]
把最后一口咖啡 喝完
站起来 关灯 回家
[Chorus]
楼道的声控灯 一层层亮
像有人 在替我数台阶`;

const seconds = Number(process.argv[2] || 60);
const temperature = Number(process.argv[3] || 1.0);
const cfgScale = Number(process.argv[4] || 1.5);
const topk = Number(process.argv[5] || 50);

const wf = buildHeartMuLa({
  lyrics,
  tags,
  seconds,
  topk,
  temperature,
  cfgScale,
  version: '3B',
  prefix: 'studio/heartmula',
});

console.log('submit...');
const id = await submit(settings.comfyUrl, wf);
console.log('promptId', id);
const files = await waitFor(settings.comfyUrl, id, { timeoutMs: 3600000 });
console.log('files', files);
if (!files || !files.length) {
  console.error('no output file');
  process.exit(1);
}
const url = await download(settings.comfyUrl, files[0], '_songhm');
console.log('URL', url);

const local = path.join(OUT, path.basename(files[0]));
fs.writeFileSync(
  path.join(OUT, 'last_hm.json'),
  JSON.stringify({ tags, lyrics, seconds, temperature, cfgScale, topk, url, local }, null, 2),
  'utf-8',
);
