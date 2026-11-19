// 极简 JSON 文件存储：项目数据落在 data/projects.json，避免引入需要编译的数据库驱动。
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.resolve(import.meta.dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'projects.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

const DEFAULT_SETTINGS = {
  comfyUrl: 'http://127.0.0.1:8188',
  llmMode: 'local',
  ollamaUrl: 'http://127.0.0.1:11434',
  llmModel: 'qwen3-14b-abl:q4',
  cloudBaseUrl: '',
  cloudApiKey: '',
  cloudModel: '',
  unet: 'qwen_image_2.1_turbo_int8_convrot.safetensors',
  clip: 'qwen3vl_8b_int8_convrot.safetensors',
  clipType: 'qwen_image',
  vae: 'qwen_image_2.1_vae_bf16.safetensors',
  steps: 8,
  cfg: 1,
  // 出图引擎：krea2 = Krea 2 + identity_edit_v2 身份 LoRA（锁脸最稳，实测同人跨场景不变脸）
  // qwen = Qwen-Image 2.1 Edit（只有一张参考、偏风格参考，脸会被重绘）
  imageEngine: 'krea2',
  kreaUnet: 'krea2_turbo_fp8_scaled.safetensors',
  kreaClip: 'qwen3vl_4b_fp8_scaled.safetensors',
  kreaVae: 'qwen_image_vae.safetensors',
  kreaLora: 'krea2_identity_edit_v2.safetensors',
  kreaRefBoost: 4,
  videoUnet: 'minimax_h3_fl2va_pruned_int8_convrot.safetensors',
  videoClip: 'qwen3vl_32b_minimax_h3_int8_convrot.safetensors',
  videoVae: 'minimax_h3_video_vae_int8_convrot.safetensors',
  videoAudioVae: 'minimax_h3_audio_vae_fp32.safetensors',
  videoSteps: 12,
  videoShift: 8,
  videoSeconds: 5,
  // LTX 2.3：文生视频，音画同一条 latent 一起采样，出来自带同期声
  // 尺寸必须和出图 9:16 一致（768×1344），否则首帧会被拉伸变形（实测 832×1216 → 640×1152 会拉扁 23%）
  ltxUnet: 'ltx-2.3-22b-distilled-1.1_int8_convrot.safetensors',
  ltxTextEncoder: 'comfy_gemma_3_12B_it.safetensors',
  ltxProjection: 'ltx-2.3_text_projection_bf16.safetensors',
  // 必须用官方 1/32 VAE 解码：tiny(1/64) 会把画面糊成一片（实测同参数码率 2095 → 3152 kb/s）
  ltxVae: 'LTX23_video_vae_bf16.safetensors',
  ltxAudioVae: 'LTX23_audio_vae_bf16.safetensors',
  ltxSteps: 8,
  ltxFps: 24,
  ltxVideoCfg: 1,
  ltxAudioCfg: 1,
  ltxWidth: 768,
  ltxHeight: 1344,
  ltxSeconds: 4,
  // 空间放大器：768×1344 -> 1536×2688（x2）。开了更清楚，但耗时约翻倍、显存吃紧，默认关
  ltxUpscale: false,
  ltxUpscaleModel: 'ltx-2.3-spatial-upscaler-x2-1.1.safetensors',
  // 音乐：ACE-Step 1.5（ComfyUI 原生节点，AIO checkpoint）
  musicCkpt: 'ace_step_1.5_turbo_aio.safetensors',
  musicSteps: 8,
  musicBpm: 90,
  musicKeyscale: 'A minor',
  musicVolume: 0.18,
  // 配音：Qwen3-TTS（独立 venv 子进程调用）
  ttsPython: 'E:\\tts-venv\\Scripts\\python.exe',
  ttsModelPath: 'E:\\tts-models\\customvoice',
  ttsSpeaker: 'serena',
  ttsLanguage: 'Chinese',
  ttsInstruct: '',
  // 成片拼接
  voiceVolume: 1,
  ambientVolume: 0.35,
  burnSubtitle: true,
};

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  ensureDir();
  const tmp = `${file}.tmp`;
  const text = JSON.stringify(value, null, 2);
  fs.writeFileSync(tmp, text, 'utf-8');
  // Windows 上 rename 会因杀毒/文件锁偶发 EPERM，退化到「直接覆盖 + 清理临时文件」，
  // 不能让它把整个后端进程崩掉。
  try {
    fs.renameSync(tmp, file);
  } catch {
    fs.writeFileSync(file, text, 'utf-8');
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* 临时文件清不掉不影响主流程 */
    }
  }
}

export function listProjects() {
  return readJson(DB_FILE, []);
}

export function saveProjects(projects) {
  writeJson(DB_FILE, projects);
}

export function getProject(id) {
  return listProjects().find((p) => p.id === id) ?? null;
}

export function putProject(project) {
  const projects = listProjects();
  const idx = projects.findIndex((p) => p.id === project.id);
  if (idx === -1) projects.push(project);
  else projects[idx] = project;
  saveProjects(projects);
  return project;
}

export function getSettings() {
  return { ...DEFAULT_SETTINGS, ...readJson(SETTINGS_FILE, {}) };
}

export function saveSettings(patch) {
  const next = { ...getSettings(), ...patch };
  writeJson(SETTINGS_FILE, next);
  return next;
}

export function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
