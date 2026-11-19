// ComfyUI 工作流构造：Qwen-Image 2.1 Turbo 文生图 / 图像编辑（角色参考锁定）。
// 参数取自本机成功生成过的真实工作流（steps 8 / cfg 1.0 / euler + simple）。

export const RATIOS = {
  '9:16': { width: 768, height: 1344 },
  '16:9': { width: 1216, height: 832 },
  '1:1': { width: 1024, height: 1024 },
  '3:4': { width: 896, height: 1152 },
};

const NEGATIVE_DEFAULT =
  '低质量, 模糊, 畸形, 多余肢体, 错误手指, 文字, 水印, 过曝, 死黑, 塑料感, 3D渲染感, 分格, 拼图, 多格漫画, 分屏, 上下分幅, 左右分幅, 边框分割, 网格线, 同一人物重复出现';

function sampler({ settings, seed, positive, negative, latent }) {
  return {
    class_type: 'KSampler',
    inputs: {
      seed,
      steps: settings.steps ?? 8,
      cfg: settings.cfg ?? 1,
      sampler_name: 'euler',
      scheduler: 'simple',
      denoise: 1,
      model: ['4', 0],
      positive,
      negative,
      latent_image: latent,
    },
  };
}

function loaders(settings) {
  return {
    4: {
      class_type: 'UNETLoader',
      inputs: { unet_name: settings.unet, weight_dtype: 'default' },
    },
    5: {
      class_type: 'CLIPLoader',
      inputs: { clip_name: settings.clip, type: settings.clipType || 'qwen_image' },
    },
    6: { class_type: 'VAELoader', inputs: { vae_name: settings.vae } },
  };
}

export function buildTxt2Img({ settings, prompt, negative, width, height, seed, prefix }) {
  return {
    ...loaders(settings),
    7: { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['5', 0] } },
    8: {
      class_type: 'CLIPTextEncode',
      inputs: { text: negative || NEGATIVE_DEFAULT, clip: ['5', 0] },
    },
    9: {
      class_type: 'EmptySD3LatentImage',
      inputs: { width, height, batch_size: 1 },
    },
    10: sampler({
      settings,
      seed,
      positive: ['7', 0],
      negative: ['8', 0],
      latent: ['9', 0],
    }),
    11: { class_type: 'VAEDecode', inputs: { samples: ['10', 0], vae: ['6', 0] } },
    12: { class_type: 'SaveImage', inputs: { images: ['11', 0], filename_prefix: prefix } },
  };
}

export function buildEdit({ settings, prompt, negative, imageName, width, height, seed, prefix }) {
  return {
    ...loaders(settings),
    20: { class_type: 'LoadImage', inputs: { image: imageName } },
    7: {
      class_type: 'TextEncodeQwenImageEdit',
      inputs: { clip: ['5', 0], prompt, vae: ['6', 0], image: ['20', 0] },
    },
    8: {
      class_type: 'CLIPTextEncode',
      inputs: { text: negative || NEGATIVE_DEFAULT, clip: ['5', 0] },
    },
    9: { class_type: 'EmptySD3LatentImage', inputs: { width, height, batch_size: 1 } },
    10: sampler({
      settings,
      seed,
      positive: ['7', 0],
      negative: ['8', 0],
      latent: ['9', 0],
    }),
    11: { class_type: 'VAEDecode', inputs: { samples: ['10', 0], vae: ['6', 0] } },
    12: { class_type: 'SaveImage', inputs: { images: ['11', 0], filename_prefix: prefix } },
  };
}

/**
 * Qwen-Image-Edit Plus：最多 3 张参考图。
 * 用途：image1 人物定妆、image2 商品/道具、image3 场景板或手部。
 * 本机 8188 已确认该节点存在（optional: image1/image2/image3）。
 */
export function buildEditMulti({
  settings,
  prompt,
  negative,
  imageNames = [],
  width,
  height,
  seed,
  prefix,
}) {
  const imgs = imageNames.filter(Boolean).slice(0, 3);
  const nodes = { ...loaders(settings) };

  imgs.forEach((name, i) => {
    nodes[20 + i] = { class_type: 'LoadImage', inputs: { image: name } };
  });

  const encInputs = { clip: ['5', 0], prompt, vae: ['6', 0] };
  imgs.forEach((_, i) => {
    encInputs[`image${i + 1}`] = [20 + i, 0];
  });

  nodes[7] = { class_type: 'TextEncodeQwenImageEditPlus', inputs: encInputs };
  nodes[8] = {
    class_type: 'CLIPTextEncode',
    inputs: { text: negative || NEGATIVE_DEFAULT, clip: ['5', 0] },
  };
  nodes[9] = {
    class_type: 'EmptySD3LatentImage',
    inputs: { width, height, batch_size: 1 },
  };
  nodes[10] = sampler({
    settings,
    seed,
    positive: ['7', 0],
    negative: ['8', 0],
    latent: ['9', 0],
  });
  nodes[11] = { class_type: 'VAEDecode', inputs: { samples: ['10', 0], vae: ['6', 0] } };
  nodes[12] = { class_type: 'SaveImage', inputs: { images: ['11', 0], filename_prefix: prefix } };

  return nodes;
}

/**
 * Krea 2 + identity_edit_v2：真正锁人物身份的出图链路。
 * 结构反解自本机已验证产物 krea2edit_ff01_ff03（同一主角跨场景、双人同框、手部特写都不变脸）。
 * 关键参数：ref_boost=4.0 强压参考图；ref_position='aligned (trained)' 是该 LoRA 训练时的位置。
 * 支持第二张参考图（source_image_b），用来同时锁商品/道具。
 */
export function buildKrea2IdentityEdit({
  settings,
  prompt,
  negative,
  imageName,
  imageNameB,
  width,
  height,
  seed,
  prefix,
  refBoost,
}) {
  const nodes = {
    1: {
      class_type: 'UNETLoader',
      inputs: {
        unet_name: settings.kreaUnet ?? 'krea2_turbo_fp8_scaled.safetensors',
        weight_dtype: 'default',
      },
    },
    2: {
      class_type: 'CLIPLoader',
      inputs: {
        clip_name: settings.kreaClip ?? 'qwen3vl_4b_fp8_scaled.safetensors',
        type: 'krea2',
        device: 'default',
      },
    },
    3: {
      class_type: 'VAELoader',
      inputs: { vae_name: settings.kreaVae ?? 'qwen_image_vae.safetensors' },
    },
    4: {
      class_type: 'LoraLoaderModelOnly',
      inputs: {
        lora_name: settings.kreaLora ?? 'krea2_identity_edit_v2.safetensors',
        strength_model: 1,
        model: ['1', 0],
      },
    },
    10: { class_type: 'LoadImage', inputs: { image: imageName } },
    11: { class_type: 'VAEEncode', inputs: { pixels: ['10', 0], vae: ['3', 0] } },
    12: {
      class_type: 'EmptySD3LatentImage',
      inputs: { width, height, batch_size: 1 },
    },
  };

  if (imageNameB) {
    nodes[20] = { class_type: 'LoadImage', inputs: { image: imageNameB } };
    nodes[21] = { class_type: 'VAEEncode', inputs: { pixels: ['20', 0], vae: ['3', 0] } };
  }

  const patchInputs = {
    model: ['4', 0],
    source_latent: ['11', 0],
    vae: ['3', 0],
    source_image: ['10', 0],
    target_latent: ['12', 0],
    ref_boost: Number(refBoost ?? settings.kreaRefBoost ?? 4),
    fit_mode: 'fit',
    ref_position: 'aligned (trained)',
  };
  if (imageNameB) {
    patchInputs.source_latent_b = ['21', 0];
    patchInputs.source_image_b = ['20', 0];
    patchInputs.ref_boost_a = Number(refBoost ?? settings.kreaRefBoost ?? 4);
  }
  nodes[13] = { class_type: 'Krea2EditModelPatch', inputs: patchInputs };

  const encBase = { clip: ['2', 0], image: ['10', 0], grounding_px: 1024 };
  if (imageNameB) encBase.image_b = ['20', 0];

  nodes[14] = {
    class_type: 'Krea2EditGroundedEncode',
    inputs: { ...encBase, prompt },
  };
  nodes[15] = {
    class_type: 'Krea2EditGroundedEncode',
    inputs: { ...encBase, prompt: negative ? '' : '' },
  };

  nodes[16] = {
    class_type: 'KSampler',
    inputs: {
      model: ['13', 0],
      positive: ['14', 0],
      negative: ['15', 0],
      latent_image: ['12', 0],
      seed,
      steps: Number(settings.steps) || 8,
      cfg: Number(settings.cfg) || 1,
      sampler_name: 'euler',
      scheduler: 'simple',
      denoise: 1,
    },
  };
  nodes[17] = { class_type: 'VAEDecode', inputs: { samples: ['16', 0], vae: ['3', 0] } };
  nodes[18] = {
    class_type: 'SaveImage',
    inputs: { images: ['17', 0], filename_prefix: prefix },
  };

  return nodes;
}

export const NEGATIVE_DEFAULT_TEXT = NEGATIVE_DEFAULT;

/** H3 的帧数网格是 17k + 5，5 秒 ≈ 124 帧（24fps）。 */
export function framesForSeconds(seconds) {
  const target = Math.round((Number(seconds) || 5) * 24);
  const k = Math.max(1, Math.round((target - 5) / 17));
  return 17 * k + 5;
}

/**
 * MiniMax H3 图生视频：首帧 + 提示词 → 5 秒左右带音轨的短片。
 * 链路已在本机实测（832×1216 / 124 帧 / 8 步 / euler+simple）。
 */
export function buildVideo({ settings, prompt, imageName, width, height, length, seed, prefix }) {
  return {
    4: {
      class_type: 'UNETLoader',
      inputs: { unet_name: settings.videoUnet, weight_dtype: 'default' },
    },
    5: {
      class_type: 'CLIPLoader',
      inputs: { clip_name: settings.videoClip, type: 'minimax' },
    },
    6: { class_type: 'VAELoader', inputs: { vae_name: settings.videoVae } },
    7: { class_type: 'VAELoader', inputs: { vae_name: settings.videoAudioVae } },
    20: { class_type: 'LoadImage', inputs: { image: imageName } },
    21: {
      class_type: 'MiniMaxH3ImageToVideo',
      inputs: {
        clip: ['5', 0],
        vae: ['6', 0],
        prompt,
        width,
        height,
        length,
        first_frame: ['20', 0],
      },
    },
    8: { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['5', 0] } },
    30: {
      class_type: 'MiniMaxH3SigmaShift',
      inputs: {
        model: ['4', 0],
        shift_video: Number(settings.videoShift) || 12,
        shift_audio: 3,
      },
    },
    10: {
      class_type: 'KSampler',
      inputs: {
        seed,
        steps: Number(settings.videoSteps) || 8,
        cfg: 5,
        sampler_name: 'euler',
        scheduler: 'simple',
        denoise: 1,
        model: ['30', 0],
        positive: ['21', 0],
        negative: ['8', 0],
        latent_image: ['21', 1],
      },
    },
    11: { class_type: 'VAEDecode', inputs: { samples: ['10', 0], vae: ['6', 0] } },
    12: { class_type: 'VAEDecodeAudio', inputs: { samples: ['10', 0], vae: ['7', 0] } },
    13: {
      class_type: 'VHS_VideoCombine',
      inputs: {
        images: ['11', 0],
        audio: ['12', 0],
        frame_rate: 24,
        loop_count: 0,
        filename_prefix: prefix,
        format: 'video/h264-mp4',
        pingpong: false,
        save_output: true,
      },
    },
  };
}

/** LTX 2.3 的帧数网格：帧数 - 1 必须能被 8 整除，4 秒 ≈ 97 帧（24fps）。 */
export function ltxFramesForSeconds(seconds) {
  const target = Math.round((Number(seconds) || 4) * 24) + 1;
  const k = Math.max(6, Math.round((target - 1) / 8));
  return 8 * k + 1;
}

/**
 * LTX 2.3 图生视频：关键帧作首帧注入 latent（LTXVImgToVideo），锁住角色长相与构图，
 * 仍然是音画共用一条 latent 一起采样，出来自带同期声。
 * 本机实测 640×1152 / 97 帧 / 8 步 = 84 秒出片（RTX 3080 20G）。
 */
export function buildLtxImg2Video({
  settings,
  prompt,
  negative,
  imageName,
  width,
  height,
  frames,
  steps,
  fps,
  seed,
  prefix,
  strength = 1,
}) {
  const ltxNegative =
    negative || 'blurry, low quality, distorted, watermark, text, extra limbs, deformed face';
  const videoCfg = Number(settings.ltxVideoCfg) || 1;
  const audioCfg = Number(settings.ltxAudioCfg) || 1;
  return {
    1: {
      class_type: 'UNETLoader',
      inputs: { unet_name: settings.ltxUnet, weight_dtype: 'default' },
    },
    2: {
      class_type: 'ModelSamplingLTXV',
      inputs: { model: ['1', 0], max_shift: 2.05, base_shift: 0.95, latent: ['12', 0] },
    },
    3: {
      class_type: 'LTXAVTextEncoderLoader',
      inputs: {
        text_encoder: settings.ltxTextEncoder,
        ckpt_name: settings.ltxProjection,
        device: 'default',
      },
    },
    4: { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['3', 0] } },
    5: { class_type: 'CLIPTextEncode', inputs: { text: ltxNegative, clip: ['3', 0] } },
    6: { class_type: 'LoadImage', inputs: { image: imageName } },
    7: { class_type: 'VAELoader', inputs: { vae_name: settings.ltxVae } },
    8: { class_type: 'LTXVAudioVAELoader', inputs: { ckpt_name: settings.ltxAudioVae } },
    // 首帧条件 + 建 video latent 一步完成，尺寸/帧数由这里定
    9: {
      class_type: 'LTXVImgToVideo',
      inputs: {
        positive: ['4', 0],
        negative: ['5', 0],
        vae: ['7', 0],
        image: ['6', 0],
        width,
        height,
        length: frames,
        batch_size: 1,
        strength,
      },
    },
    10: {
      class_type: 'LTXVConditioning',
      inputs: { positive: ['9', 0], negative: ['9', 1], frame_rate: fps },
    },
    11: {
      class_type: 'LTXVEmptyLatentAudio',
      inputs: { frames_number: frames, frame_rate: fps, batch_size: 1, audio_vae: ['8', 0] },
    },
    12: {
      class_type: 'LTXVConcatAVLatent',
      inputs: { video_latent: ['9', 2], audio_latent: ['11', 0] },
    },
    13: {
      class_type: 'LTXVScheduler',
      inputs: {
        steps,
        max_shift: 2.05,
        base_shift: 0.95,
        stretch: true,
        terminal: 0.1,
        latent: ['12', 0],
      },
    },
    14: { class_type: 'RandomNoise', inputs: { noise_seed: seed } },
    15: { class_type: 'KSamplerSelect', inputs: { sampler_name: 'euler' } },
    16: {
      class_type: 'LTXVDualCFGGuider',
      inputs: {
        model: ['2', 0],
        positive: ['10', 0],
        negative: ['10', 1],
        video_cfg: videoCfg,
        audio_cfg: audioCfg,
      },
    },
    17: {
      class_type: 'SamplerCustomAdvanced',
      inputs: {
        noise: ['14', 0],
        guider: ['16', 0],
        sampler: ['15', 0],
        sigmas: ['13', 0],
        latent_image: ['12', 0],
      },
    },
    18: { class_type: 'LTXVSeparateAVLatent', inputs: { av_latent: ['17', 0] } },
    19: { class_type: 'VAEDecode', inputs: { samples: ['18', 0], vae: ['7', 0] } },
    20: {
      class_type: 'LTXVAudioVAEDecode',
      inputs: { samples: ['18', 1], audio_vae: ['8', 0] },
    },
    21: {
      class_type: 'CreateVideo',
      inputs: { images: ['19', 0], fps, audio: ['20', 0] },
    },
    22: {
      class_type: 'SaveVideo',
      inputs: { video: ['21', 0], filename_prefix: prefix, format: 'mp4' },
    },
  };
}

/**
 * LTX 2.3 文生视频：音频和视频共用同一条 latent 一起采样，出来就是带同音轨的竖屏片。
 * 本机实测 640×1152 / 97 帧 / 8 步 = 64 秒出片（RTX 3080 20G）。
 */
export function buildLtxVideo({
  settings,
  prompt,
  negative,
  width,
  height,
  frames,
  steps,
  fps,
  seed,
  prefix,
}) {
  const ltxNegative =
    negative || 'blurry, low quality, distorted, watermark, text, extra limbs, deformed face';
  const videoCfg = Number(settings.ltxVideoCfg) || 1;
  const audioCfg = Number(settings.ltxAudioCfg) || 1;
  return {
    1: {
      class_type: 'UNETLoader',
      inputs: { unet_name: settings.ltxUnet, weight_dtype: 'default' },
    },
    2: {
      class_type: 'ModelSamplingLTXV',
      inputs: { model: ['1', 0], max_shift: 2.05, base_shift: 0.95, latent: ['10', 0] },
    },
    3: {
      class_type: 'LTXAVTextEncoderLoader',
      inputs: {
        text_encoder: settings.ltxTextEncoder,
        ckpt_name: settings.ltxProjection,
        device: 'default',
      },
    },
    4: { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['3', 0] } },
    5: { class_type: 'CLIPTextEncode', inputs: { text: ltxNegative, clip: ['3', 0] } },
    6: {
      class_type: 'LTXVConditioning',
      inputs: { positive: ['4', 0], negative: ['5', 0], frame_rate: fps },
    },
    7: {
      class_type: 'EmptyLTXVLatentVideo',
      inputs: { width, height, length: frames, batch_size: 1 },
    },
    8: { class_type: 'LTXVAudioVAELoader', inputs: { ckpt_name: settings.ltxAudioVae } },
    9: {
      class_type: 'LTXVEmptyLatentAudio',
      inputs: { frames_number: frames, frame_rate: fps, batch_size: 1, audio_vae: ['8', 0] },
    },
    10: {
      class_type: 'LTXVConcatAVLatent',
      inputs: { video_latent: ['7', 0], audio_latent: ['9', 0] },
    },
    11: {
      class_type: 'LTXVScheduler',
      inputs: {
        steps,
        max_shift: 2.05,
        base_shift: 0.95,
        stretch: true,
        terminal: 0.1,
        latent: ['10', 0],
      },
    },
    12: { class_type: 'RandomNoise', inputs: { noise_seed: seed } },
    13: { class_type: 'KSamplerSelect', inputs: { sampler_name: 'euler' } },
    14: {
      class_type: 'LTXVDualCFGGuider',
      inputs: {
        model: ['2', 0],
        positive: ['6', 0],
        negative: ['6', 1],
        video_cfg: videoCfg,
        audio_cfg: audioCfg,
      },
    },
    15: {
      class_type: 'SamplerCustomAdvanced',
      inputs: {
        noise: ['12', 0],
        guider: ['14', 0],
        sampler: ['13', 0],
        sigmas: ['11', 0],
        latent_image: ['10', 0],
      },
    },
    16: { class_type: 'LTXVSeparateAVLatent', inputs: { av_latent: ['15', 0] } },
    17: { class_type: 'VAELoader', inputs: { vae_name: settings.ltxVae } },
    18: { class_type: 'VAEDecode', inputs: { samples: ['16', 0], vae: ['17', 0] } },
    19: {
      class_type: 'LTXVAudioVAEDecode',
      inputs: { samples: ['16', 1], audio_vae: ['8', 0] },
    },
    20: {
      class_type: 'CreateVideo',
      inputs: { images: ['18', 0], fps, audio: ['19', 0] },
    },
    21: {
      class_type: 'SaveVideo',
      inputs: { video: ['20', 0], filename_prefix: prefix, format: 'mp4' },
    },
  };
}

/**
 * ACE-Step 1.5 音乐生成（本机实测 30 秒曲目 16 秒出片）。
 * AIO checkpoint 走 CheckpointLoaderSimple，负条件用 ConditioningZeroOut。
 */
export function buildMusic({
  settings,
  tags,
  lyrics = '',
  bpm,
  seconds = 30,
  keyscale,
  timesignature = '4',
  language = 'en',
  seed,
  prefix,
}) {
  return {
    1: {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: settings.musicCkpt || 'ace_step_1.5_turbo_aio.safetensors' },
    },
    2: {
      class_type: 'TextEncodeAceStepAudio1.5',
      inputs: {
        clip: ['1', 1],
        tags,
        lyrics,
        seed,
        bpm: Number(bpm) || Number(settings.musicBpm) || 90,
        duration: Number(seconds) || 30,
        timesignature,
        language,
        keyscale: keyscale || settings.musicKeyscale || 'A minor',
        generate_audio_codes: true,
        cfg_scale: 2.0,
        temperature: 0.85,
        top_p: 0.9,
        top_k: 0,
        min_p: 0.0,
      },
    },
    3: { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['2', 0] } },
    4: {
      class_type: 'EmptyAceStep1.5LatentAudio',
      inputs: { seconds: Number(seconds) || 30, batch_size: 1 },
    },
    5: {
      class_type: 'KSampler',
      inputs: {
        seed,
        steps: Number(settings.musicSteps) || 8,
        cfg: 1,
        sampler_name: 'euler',
        scheduler: 'simple',
        denoise: 1,
        model: ['1', 0],
        positive: ['2', 0],
        negative: ['3', 0],
        latent_image: ['4', 0],
      },
    },
    6: { class_type: 'VAEDecodeAudio', inputs: { samples: ['5', 0], vae: ['1', 2] } },
    7: {
      class_type: 'SaveAudioMP3',
      inputs: { audio: ['6', 0], filename_prefix: prefix, quality: 'V0' },
    },
  };
}

/**
 * 给 LTX 图/文生视频工作流挂上「空间放大器 x2」，把 768×1344 拉到 1536×2688。
 * 依赖既有节点编号约定：VAELoader=7、LTXVSeparateAVLatent=18、VAEDecode=19（两条链路一致）。
 * 打开后单镜耗时约翻倍、显存吃紧，故默认关闭，由 settings.ltxUpscale 控制。
 * 实测参考：768×1344 / 33 帧 / 8 步 => 1536×2688，110 秒，12.2 Mbps。
 */
export function applyLtxUpscale(workflow, settings) {
  if (!settings?.ltxUpscale) return workflow;
  if (!workflow?.[18] || !workflow?.[19] || !workflow?.[7]) return workflow;
  workflow[24] = {
    class_type: 'LatentUpscaleModelLoader',
    inputs: { model_name: settings.ltxUpscaleModel || 'ltx-2.3-spatial-upscaler-x2-1.1.safetensors' },
  };
  workflow[25] = {
    class_type: 'LTXVLatentUpsampler',
    inputs: { samples: ['18', 0], upscale_model: ['24', 0], vae: ['7', 0] },
  };
  workflow[19].inputs.samples = ['25', 0];
  return workflow;
}

/**
 * MiniMax Music 3 出歌（ComfyUI 原生节点）。
 * 与 ACE-Step 的差别：中文吐字、人声表现明显更强，最长 5 分钟，输入是
 * 「结构化 caption（风格/人声/编曲）+ 带段落标签的歌词」。
 */
export function buildMusic3({
  settings,
  caption,
  lyrics,
  seconds = 60,
  seed,
  steps = 24,
  cfgScale = 1.5,
  topK = 50,
  prefix = 'studio/music3',
}) {
  return {
    1: {
      class_type: 'UNETLoader',
      inputs: {
        unet_name: settings.music3Dit || 'minimax_music3_dit_int8_convrot.safetensors',
        weight_dtype: 'default',
      },
    },
    2: {
      class_type: 'CLIPLoader',
      inputs: {
        clip_name: settings.music3Clip || 'minimax_music3_text_encoder_pruned_int8_convrot.safetensors',
        type: 'minimax',
      },
    },
    3: {
      class_type: 'MiniMaxMusic3TextEncode',
      inputs: {
        clip: ['2', 0],
        caption,
        lyrics,
        seed,
        max_duration: Number(seconds) || 60,
        cfg_scale: cfgScale,
        top_k: topK,
      },
    },
    4: {
      class_type: 'EmptyMiniMaxMusic3LatentAudio',
      inputs: { seconds: ['3', 1], batch_size: 1 },
    },
    5: {
      class_type: 'KSampler',
      inputs: {
        seed,
        steps: Number(steps) || 24,
        cfg: 1,
        sampler_name: 'euler',
        scheduler: 'simple',
        denoise: 1,
        model: ['1', 0],
        positive: ['3', 0],
        negative: ['3', 0],
        latent_image: ['4', 0],
      },
    },
    6: {
      class_type: 'VAELoader',
      inputs: { vae_name: settings.music3Vae || 'minimax_music3_dav.safetensors' },
    },
    7: {
      class_type: 'VAEDecodeAudio',
      inputs: { samples: ['5', 0], vae: ['6', 0] },
    },
    8: {
      class_type: 'SaveAudioMP3',
      inputs: { audio: ['7', 0], filename_prefix: prefix, quality: '320k' },
    },
  };
}

// HeartMuLa（第二套可商用歌声模型，Apache-2.0）
export function buildHeartMuLa({
  lyrics,
  tags,
  seconds = 60,
  topk = 50,
  temperature = 1.0,
  cfgScale = 1.5,
  version = '3B',
  prefix = 'studio/heartmula',
}) {
  return {
    1: {
      class_type: 'HeartMuLa_Generate',
      inputs: {
        lyrics,
        tags,
        version,
        max_audio_length_ms: Math.round((Number(seconds) || 60) * 1000),
        topk: Number(topk) || 50,
        temperature: Number(temperature) || 1.0,
        cfg_scale: Number(cfgScale) || 1.5,
      },
    },
    2: {
      class_type: 'SaveAudioMP3',
      inputs: { audio: ['1', 0], filename_prefix: prefix, quality: '320k' },
    },
  };
}
