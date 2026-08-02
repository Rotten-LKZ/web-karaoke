/**
 * 七牛 CDN 私有 URL 签名。
 *
 * 算法（复刻自 oshifish/apps/api/src/s3/presign.ts 的 getCdnUrlAsync）：
 *   deadline = floor(now/1000) + expiresIn
 *   url      = `${CDN_DOMAIN}/${encodeKey(key)}?e=${deadline}`
 *   sign     = urlSafeBase64( HMAC-SHA1(url, QINIU_SK) )
 *   token    = `${QINIU_AK}:${sign}`
 *   最终     = `${url}&token=${token}`
 *
 * 纯 Web Crypto + btoa，零依赖。
 */

export interface SignEnv {
  /** 七牛 CDN 域名，如 https://cdn.example.com（无尾斜杠）。 */
  CDN_DOMAIN: string;
  /** 七牛 AccessKey。 */
  QINIU_AK: string;
  /** 七牛 SecretKey。 */
  QINIU_SK: string;
}

/**
 * 生成七牛 CDN 私有签名 URL。
 * @param nowMs 可选的时间戳注入，便于测试；默认 Date.now()。
 */
export async function signQiniuUrl(
  env: SignEnv,
  key: string,
  expiresIn: number,
  nowMs: number = Date.now(),
): Promise<string> {
  if (!env.CDN_DOMAIN || !env.QINIU_AK || !env.QINIU_SK) {
    throw new Error('missing qiniu config: CDN_DOMAIN / QINIU_AK / QINIU_SK');
  }
  const domain = env.CDN_DOMAIN.replace(/\/+$/, '');

  const deadline = Math.floor(nowMs / 1000) + expiresIn;
  const url = `${domain}/${encodeKey(key)}?e=${deadline}`;

  const sign = await hmacSha1(url, env.QINIU_SK);
  const token = `${env.QINIU_AK}:${urlSafeBase64(sign)}`;
  return `${url}&token=${token}`;
}

/** HMAC-SHA1(data, key) → ArrayBuffer。 */
async function hmacSha1(data: string, key: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(key),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  return crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data));
}

/** URL-safe Base64（+→- / →_ 去填充）。 */
function urlSafeBase64(buffer: ArrayBuffer): string {
  const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/** 按 / 分段编码 key，保留路径分隔符。 */
function encodeKey(key: string): string {
  return key
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}
