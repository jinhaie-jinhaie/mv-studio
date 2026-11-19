// SeedVR2 视频超分：把 0.5MP 的口型片放大到 1080p，救清晰度（生成端显存提不上分辨率）。
// 用法：node tools/upscale_video.mjs <ComfyUI input 里的视频文件名> [目标短边=1080] [seed]
import fs from 'node:fs';
import path from 'node:path';
import { getSettings } from '../server/db.js';
import { submit, waitFor, download, outputDir } from '../server/comfy.js';

const settings = getSettings();
const videoName = process.argv[2];
const resolution = Number(process.argv[3] || 1080);
const seed = Number(process.argv[4] || 42);
if (!videoName) {
  console.error('usage: node tools/upscale_video.mjs <videoName> [resolution] [seed]');
  process.exit(1);
}

const wf = {
  10: {
    class_type: 'VHS_LoadVideo',
    inputs: {
      video: videoName,
      force_rate: 0,
      custom_width: 0,
      custom_height: 0,
      frame_load_cap: 0,
      skip_first_frames: 0,
      select_every_nth: 1,
      format: 'None',
    },
  },
  11: {
    class_type: 'SeedVR2LoadDiTModel',
    inputs: { model: 'seedvr2_ema_7b-Q8_0.gguf', device: 'cuda:0', blocks_to_swap: 0 },
  },
  12: {
    class_type: 'SeedVR2LoadVAEModel',
    inputs: { model: 'ema_vae_fp16.safetensors', device: 'cuda:0' },
  },
  20: {
    class_type: 'SeedVR2VideoUpscaler',
    inputs: {
      image: ['10', 0],
      dit: ['11', 0],
      vae: ['12', 0],
      seed,
      resolution,
      max_resolution: 0,
      batch_size: 5,
      uniform_batch_size: false,
      color_correction: 'lab',
    },
  },
  30: {
    class_type: 'VHS_VideoCombine',
    inputs: {
      images: ['20', 0],
      audio: ['10', 2],
      frame_rate: 24,
      loop_count: 0,
      filename_prefix: 'studio/upscaled',
      format: 'video/h264-mp4',
      pingpong: false,
      save_output: true,
    },
  },
};

console.log('提交 SeedVR2 超分…', { videoName, resolution, seed });
const files = await waitFor(settings.comfyUrl, await submit(settings.comfyUrl, wf), {
  timeoutMs: 3 * 3600 * 1000,
});
console.log('产物', files);
const rel = await download(settings.comfyUrl, files[0], '_mvsing');
const abs = path.join(outputDir, path.relative('/output', rel));
console.log('完成', abs);
