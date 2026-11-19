# 本地 AI MV 生产线（ComfyUI / RTX 3080 20GB）

一套可以真正跑出「中文歌 + 唱歌口型 + 高清成片」的本地流水线，全部在本机 ComfyUI 上完成，不依赖云 API。

产出目标：9:16 竖屏 MV，60 秒，人声可商用，画面有跟歌词对得上的口型。

---

## 一、链路

```
歌词 + 标签
   │
   ├─(1) HeartMuLa 出歌 ─────────────► 60s / 48kHz / 320kbps mp3   [Apache-2.0，可商用]
   │
   ├─(2) 首帧"真实化" ───────────────► 真实酒吧实拍照 + 歌手合成（图生图）
   │
   ├─(3) H3 数字人：原音频驱动口型 ──► 544×960 / 24fps / 60s mp4   [原音最后整段合成一次]
   │
   ├─(4) SeedVR2 超分 ───────────────► 1080p 清晰版
   │
   └─(5) 剪辑 ───────────────────────► 多机位 / 空镜穿插 / 标题 → 成片
```

关键认知（踩了很多坑才定下来）：

- **唱歌口型不能用 Wav2Lip 类语音口型模型**（video-retalking 试过，60 秒成片被直接否掉，原话"口型不对，一直在动嘴"）。语音口型只对齐"嘴在动"，对不上旋律和咬字。
- **要真正对得上，必须用"原音频驱动"的音视频联合模型**，本机可用的是 ComfyUI 插件 `ComfyUI-H3-Latent-Guide-SGUN` 里的 `H3DigitalHuman`（显示名「H3 数字人：原音频驱动长视频 by神棍」）。
- 它把整首歌锁成音频潜变量逐段采样，**模型只生成画面，原音最后连续合成一次**，所以音画天然对齐，不是后期贴的。

---

## 二、硬件与显存实测

| 项 | 值 |
|---|---|
| GPU | RTX 3080 20GB（20480 MiB） |
| H3 数字人 0.4MP / 8 步 / 8 秒段 | 约 5 分钟/段，全程显存 ~19.1GB |
| H3 数字人 0.5MP / 12 步 / 8 秒段 | 约 7 分钟/段，全程显存 ~19.4GB |
| 60 秒整曲（8 段） | 0.5MP/12 步约 55–60 分钟 |
| SeedVR2 7B Q8 超分 | 短边 1080，需先卸载生成模型 |

> 显存已经很紧：0.5MP 时 19.4/20.5GB。**不要再往上加分辨率**，试过 0.6MP 有崩机风险。清晰度靠后期超分解决，不靠提高生成像素。

---

## 三、三个核心环节怎么用

### 1. 出歌（可商用）

模型：`HeartMuLa/HeartMuLa-oss-3B` + `HeartCodec-oss-20260123`（均 Apache-2.0）。

```bash
node tools/make_song_hm.mjs 60 1.0 1.5 50
# 参数：秒数 / temperature / cfg_scale / topk
```

调参经验：
- `temperature 1.0` 中性；`0.8` 咬字更硬；`1.2` 旋律更活但容易含糊。
- `topk 50` 稳；`60–80` 更饱满，但更吃显存。
- 歌词 12 句、**不要前奏、干声贴麦**，人声清晰度最好。

### 2. 口型（H3DigitalHuman）

```bash
node tools/make_digital_human.mjs <音频在input的文件名> <首帧图在input的文件名> [时长0=全部] [段长] [seed] [百万像素] [步数] [场景图]
```

示例（8 秒试片）：

```bash
node tools/make_digital_human.mjs dh_song8.wav dh_sing_ref2.png 0 8 771122 0.5 12
```

要素说明：
- 音频、参考图都必须先放进 `ComfyUI/input/`（`LoadAudio` / `LoadImage` 只认这里的文件）。
- `ref_images` 在 API 里的键是 **flat key**：`"ref_images.ref_image_0": ["20", 0]`、`"ref_images.ref_image_1": ["21", 0]`。
- 提示词里用 `<Picture 1>`、`<Picture 2>` 引用，编号从 1 起，接口后缀从 0 起。
- `segment_seconds` 自动取 5.875 / 8 / 10.125 / 12.25 / 14.375 中最近的一档，内含 39 帧（1.625 秒）续接上下文。

### 3. 超分（SeedVR2）

```bash
node tools/upscale_video.mjs dh_test8.mp4 1080
```

用的是本机 `models/SEEDVR2/seedvr2_ema_7b-Q8_0.gguf` + `ema_vae_fp16.safetensors`，
走 `VHS_LoadVideo → SeedVR2VideoUpscaler → VHS_VideoCombine`，原音轨从 `VHS_LoadVideo` 的 audio 输出接回。

---

## 四、踩坑清单（省你几小时）

### H3 数字人

1. **参考图不能换背景。** 参考图是 conditioning，不是复制粘贴。如果首帧图本身就带"暖黄灯串木墙"，喂一张真实酒吧照片进去，出片背景**还是老样子**。
   正解：**先把人物合成进真实场景照，用合成图当首帧**，背景才会真的换。
2. **合成图里别留别人。** 真实照片常带调酒师、客人，模型会照着生成第二个人 / 第二双手。合成时要明确写"去掉调酒师、去掉客人、画面里只有她一个人"。
3. 节点要求近期 ComfyUI（≥ v0.38.0，需原生 H3 音视频遮罩 `_denoise_mask_values`），且 `MODEL` 上不能挂 Differential Diffusion 之类的动态遮罩补丁，否则直接报错。
4. 每段时长是显存第一杠杆：显存不够先降 `segment_seconds`，再降 `megapixels`。

### SeedVR2 / ComfyUI

5. 默认 DiT 模型名是 `seedvr2_ema_3b_fp8_e4m3fn.safetensors`，本机没有会触发自动下载（断网环境必炸）。**显式传本机已有的 `seedvr2_ema_7b-Q8_0.gguf`**。
6. `VHS_LoadVideo` 的输出顺序是 `IMAGE / frame_count / AUDIO / VIDEOINFO`，音频接索引 `2`。
7. 本机 ffmpeg 是 WinGet static build（无共享 DLL），**torchcodec 不可用**，涉及 torchcodec 存音频的代码要改 soundfile + 外部 ffmpeg。

### HeartMuLa

8. `import torchtune` 需要 torchao，但 **torchao 0.18 缺 `torchao.dtypes.nf4tensor`**，装 **0.14.0 `--no-deps`** 才能过。
9. `Expected all tensors to be on the same device` → `flow_matching.py` 的 `inference_codes()` 开头加 `self.to(device=device)`。
10. `einx` 的 `get_at` 设备不一致 → `modeling_heartcodec.py` 的 `detokenize(..., device="cpu")` 写死了，改 `device=None` 内部默认 `self.device`。
11. 节点 `torchaudio.load` 读回失败 → 改 `soundfile.read(always_2d=True, dtype="float32")` + `torch.from_numpy(data.T).contiguous()`。
12. `HeartMuLa_Generate` 的 `version` 默认值是错的（`3B-happy-new-year`），**必须显式传 `"3B"`**。
13. 权重下载走 **ModelScope 直连**（本机 14.5MB/s），HF 官方源 / hf-mirror / 多路并发在这个网络下都不可靠，`curl -C -` 甚至会让文件反向变小。

### 口型模型选型

14. video-retalking（Wav2Lip 系）在**唱歌 + 大脸特写**场景不可用：嘴一直在开合，但和旋律、咬字对不上。别在这条路上耗时间。
15. GFPGAN 后处理会把嘴糊成一块——它的整脸重绘对嘴部是灾难级破坏，做口型片一律关掉。

---

## 五、模型与许可

| 环节 | 模型 | 许可 | 可商用 |
|---|---|---|---|
| 出歌 | HeartMuLa-oss-3B + HeartCodec-oss | Apache-2.0 | 是 |
| 出歌（备选） | MiniMax Music 3 | 按其条款 | 是 |
| 口型 | MiniMax H3（fl2va int8 + Qwen3VL CLIP + video/audio VAE） | 按其条款 | 需自行确认 |
| 超分 | SeedVR2 7B | Apache-2.0 | 是 |
| ❌ 排除 | MuLaCover | CC BY-NC 4.0 | **否** |
| ❌ 排除 | YuE2 | 非商用 | **否** |

---

## 六、目录

```
server/
  comfy.js        ComfyUI 客户端：submit / waitFor / download / uploadImage
  workflows.js    各链路 API 工作流构造函数（txt2img / LTX / Music3 / HeartMuLa ...）
  db.js           默认参数与模型文件名
tools/
  make_song_hm.mjs         HeartMuLa 出歌
  make_digital_human.mjs   H3 数字人（原音频驱动口型）
  upscale_video.mjs        SeedVR2 视频超分
  make_singing_shot.mjs    文生图首帧 + LTX 图生视频（旧链路，备选）
  make_broll.mjs           空镜 B-roll 生成
  make_mv.mjs              图片运镜 + 贴歌的早期 MV 版本
```

---

## 七、环境

- ComfyUI（Windows portable，Python 3.13）
- 插件：`ComfyUI-H3-Latent-Guide-SGUN`（H3 数字人）、`HeartMuLa_ComfyUI`、`ComfyUI-VideoHelperSuite`、`ComfyUI-SeedVR2_VideoUpscaler`
- Node 22+，ffmpeg（static build 即可）
- 网络：ModelScope 直连下权重；GitHub/HF 在部分网络下不可达
