// ComfyUI 客户端：提交工作流 → 轮询 history → 取回产物文件。
import fs from 'node:fs';
import path from 'node:path';

const OUTPUT_DIR = path.resolve(import.meta.dirname, '..', 'output');

function ensureOutput() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

async function callJson(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(`ComfyUI ${res.status}`);
    err.body = body;
    throw err;
  }
  return body;
}

export function resolveComfy(base) {
  return (base || 'http://127.0.0.1:8188').replace(/\/$/, '');
}

/** 把一张本地图片上传到 ComfyUI 的 input 目录，返回它在服务端使用的文件名。 */
export async function uploadImage(base, filePath, fileName) {
  const data = fs.readFileSync(filePath);
  const form = new FormData();
  form.append('image', new Blob([data]), fileName);
  form.append('overwrite', 'true');
  const body = await callJson(`${resolveComfy(base)}/upload/image`, { method: 'POST', body: form });
  return String(body.name ?? fileName);
}

/** 提交一个 API 格式工作流，返回 prompt_id。 */
export async function submit(base, workflow) {
  const clientId = `studio_${Date.now()}`;
  const body = await callJson(`${resolveComfy(base)}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow, client_id: clientId }),
  });
  if (!body.prompt_id) {
    throw Object.assign(new Error('ComfyUI 拒绝了该工作流'), { body });
  }
  return body.prompt_id;
}

/** 轮询直到该 prompt 完成，返回产物描述列表。 */
export async function waitFor(base, promptId, { timeoutMs = 900000, intervalMs = 1500 } = {}) {
  const started = Date.now();
  const url = `${resolveComfy(base)}/history/${promptId}`;
  while (Date.now() - started < timeoutMs) {
    const body = await callJson(url);
    const entry = body[promptId];
    if (entry) {
      if (entry.status && entry.status.status_str === 'error') {
        throw Object.assign(new Error('ComfyUI 执行出错'), { body: entry.status });
      }
      const outputs = entry.outputs ?? {};
      const files = [];
      for (const nodeId of Object.keys(outputs)) {
        const node = outputs[nodeId];
        for (const key of ['images', 'gifs', 'videos', 'audio']) {
          for (const item of node[key] ?? []) {
            files.push(item);
          }
        }
      }
      if (files.length) return files;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error('生成超时');
}

/** 把产物从 ComfyUI 下载到本服务 output 目录，返回可访问的相对路径。 */
export async function download(base, file, subDir) {
  ensureOutput();
  const query = new URLSearchParams({
    filename: file.filename,
    subfolder: file.subfolder ?? '',
    type: file.type ?? 'output',
  });
  const res = await fetch(`${resolveComfy(base)}/view?${query}`);
  if (!res.ok) throw new Error(`下载产物失败 ${res.status}`);
  const dir = path.join(OUTPUT_DIR, subDir);
  fs.mkdirSync(dir, { recursive: true });
  const safeName = `${Date.now().toString(36)}_${path.basename(file.filename)}`;
  const target = path.join(dir, safeName);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(target, buf);
  return `/output/${subDir}/${safeName}`;
}

export const outputDir = OUTPUT_DIR;
