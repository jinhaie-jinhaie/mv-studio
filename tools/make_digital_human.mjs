// H3 数字人（H3DigitalHuman）：原音频驱动，歌/口播直接生口型同步画面。
// 用法：node tools/make_digital_human.mjs <音频在ComfyUI input的文件名> <参考图在input的文件名> [目标秒数0=全部] [段长] [seed] [百万像素] [步数]
import fs from 'node:fs';
import path from 'node:path';
import { getSettings } from '../server/db.js';
import { submit, waitFor, download, outputDir } from '../server/comfy.js';

const settings = getSettings();
const OUT = path.join(import.meta.dirname, '..', 'output', '_mvsing');
fs.mkdirSync(OUT, { recursive: true });

const audioName = process.argv[2];
const imageName = process.argv[3];
const duration = Number(process.argv[4] || 0);
const segSeconds = Number(process.argv[5] || 8);
const seed = Number(process.argv[6] || 771122);
const megapixels = Number(process.argv[7] || 0.4);
const steps = Number(process.argv[8] || 8);
const sceneImage = process.argv[9] || '';
if (!audioName || !imageName) {
  console.error('usage: node tools/make_digital_human.mjs <audioName> <imageName> [duration] [segment] [seed]');
  process.exit(1);
}

const PROMPT = sceneImage
  ? [
      '画面里只有一位二十七八岁的东亚女人，坐在小酒馆吧台前的高脚凳上，手里握着一支立式麦克风唱歌。',
      '她的长相和衣着参考 <Picture 1>；场景照 <Picture 2> 里的木吧台、背后一排酒瓶货架、木地板和暖色吧台灯，不要调酒师，不要其他客人，不要第二个人的手或肩。',
      '半身中景，略微仰拍，脸清楚，跟着歌真唱，嘴型跟着歌词走，呼吸、换气和闭眼都自然，握麦的手不太动。',
      '像现场用手机或小相机随手拍的：真实的光比，吧台灯照在脸上有硬阴影，皮肤有纹理和小汗光，头发有碎发，黑针织衫有褶皱，画面有轻微噪点和一点点手持晃动，',
      '不要磨皮，不要美颜，不要电影感滤镜，不要棚拍打光，不要文字水印。',
    ].join('')
  : [
      '画面里只有一位二十七八岁的东亚女人，坐在小酒馆吧台前的高脚凳上，手里握着一支立式麦克风唱歌。',
      '半身中景，略微仰拍，脸清楚，跟着歌真唱，嘴型跟着歌词走，呼吸、换气和闭眼都自然，握麦的手不太动。',
      '像现场用手机随手拍的：真实的光比，皮肤有纹理，头发有碎发，衣服有褶皱，画面有轻微噪点和一点点手持晃动，',
      '不要磨皮，不要美颜，不要电影感滤镜，不要文字水印。',
    ].join('');

const wf = {
  4: { class_type: 'UNETLoader', inputs: { unet_name: settings.videoUnet, weight_dtype: 'default' } },
  5: { class_type: 'CLIPLoader', inputs: { clip_name: settings.videoClip, type: 'minimax' } },
  6: { class_type: 'VAELoader', inputs: { vae_name: settings.videoVae } },
  7: { class_type: 'VAELoader', inputs: { vae_name: settings.videoAudioVae } },
  30: {
    class_type: 'MiniMaxH3SigmaShift',
    inputs: { model: ['4', 0], shift_video: Number(settings.videoShift) || 8, shift_audio: 3 },
  },
  41: { class_type: 'LoadAudio', inputs: { audio: audioName } },
  20: { class_type: 'LoadImage', inputs: { image: imageName } },
  ...(sceneImage ? { 21: { class_type: 'LoadImage', inputs: { image: sceneImage } } } : {}),
  50: {
    class_type: 'H3DigitalHuman',
    inputs: {
      model: ['30', 0],
      clip: ['5', 0],
      vae: ['6', 0],
      audio_vae: ['7', 0],
      audio: ['41', 0],
      prompt: PROMPT,
      segment_seconds: segSeconds,
      aspect_ratio: '9:16 (Portrait Widescreen)',
      megapixels,
      seed,
      steps,
      sampler_name: 'er_sde',
      scheduler: 'beta',
      'ref_images.ref_image_0': ['20', 0],
      ...(sceneImage ? { 'ref_images.ref_image_1': ['21', 0] } : {}),
    },
  },
  60: {
    class_type: 'SaveVideo',
    inputs: { video: ['50', 0], filename_prefix: 'studio/h3dh', format: 'mp4' },
  },
};

console.log('提交 H3 数字人任务…', { audioName, imageName, duration, segSeconds, seed, megapixels, steps });
const files = await waitFor(settings.comfyUrl, await submit(settings.comfyUrl, wf), {
  timeoutMs: 6 * 3600 * 1000,
});
console.log('产物', files);
const rel = await download(settings.comfyUrl, files[0], '_mvsing');
const abs = path.join(outputDir, path.relative('/output', rel));
console.log('完成', abs);
fs.writeFileSync(
  path.join(OUT, 'last_h3dh.json'),
  JSON.stringify({ audioName, imageName, duration, segSeconds, seed, megapixels, steps, prompt: PROMPT, abs }, null, 2),
  'utf-8',
);
