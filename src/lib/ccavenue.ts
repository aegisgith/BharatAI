// CCAvenue checkout, the wire format of their own integration kits.
//
// A request is a form-encoded string of parameters, encrypted with AES-128-CBC
// and sent as hex. The key is the MD5 of the merchant's working key and the IV is
// the bytes 00..0f. The answer comes back the same way, as `encResp`. Nothing here
// touches the database or the network, so the suite can check it byte for byte
// against Node's own crypto (scripts/verify/smoke-payments.mjs).
//
// MD5 is written out because Web Crypto does not offer it everywhere this runs:
// Workers has it as an extension, Node's subtle does not, and the verification
// suite runs the built worker under Node.

export function md5(input: Uint8Array): Uint8Array {
  const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21]
  const len = input.length
  const padded = new Uint8Array((((len + 8) >> 6) + 1) << 6)
  padded.set(input)
  padded[len] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(padded.length - 8, (len << 3) >>> 0, true)
  view.setUint32(padded.length - 4, Math.floor(len / 536870912), true)
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476
  for (let off = 0; off < padded.length; off += 64) {
    let a = a0, b = b0, c = c0, d = d0
    for (let i = 0; i < 64; i++) {
      let f: number, g: number
      if (i < 16) { f = (b & c) | (~b & d); g = i }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16 }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16 }
      else { f = c ^ (b | ~d); g = (7 * i) % 16 }
      const k = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296)
      const x = (a + f + k + view.getUint32(off + g * 4, true)) | 0
      const s = S[(i >> 4) * 4 + (i % 4)]
      a = d; d = c; c = b
      b = (b + ((x << s) | (x >>> (32 - s)))) | 0
    }
    a0 = (a0 + a) | 0; b0 = (b0 + b) | 0; c0 = (c0 + c) | 0; d0 = (d0 + d) | 0
  }
  const out = new Uint8Array(16)
  const ov = new DataView(out.buffer)
  ov.setUint32(0, a0, true); ov.setUint32(4, b0, true); ov.setUint32(8, c0, true); ov.setUint32(12, d0, true)
  return out
}

const CCAV_IV = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])

const ccavKey = (workingKey: string, usage: 'encrypt' | 'decrypt') =>
  crypto.subtle.importKey('raw', md5(new TextEncoder().encode(workingKey)), { name: 'AES-CBC' }, false, [usage])

export async function ccavEncrypt(plain: string, workingKey: string): Promise<string> {
  const out = await crypto.subtle.encrypt({ name: 'AES-CBC', iv: CCAV_IV }, await ccavKey(workingKey, 'encrypt'), new TextEncoder().encode(plain))
  return Array.from(new Uint8Array(out)).map(b => b.toString(16).padStart(2, '0')).join('')
}

// Returns the decrypted text, or null for anything that is not a clean message:
// not hex, not whole blocks, wrong padding, not UTF-8, or carrying control bytes.
//
// The last two matter. CBC has no integrity check, and the answer travels through
// the buyer's browser, so blocks can be cut from one genuine answer and pasted into
// another. Every such join leaves sixteen bytes of noise behind, and noise is
// almost never printable text. Every failure looks the same to the caller on
// purpose: a different answer for "bad padding" is what a padding oracle is.
export async function ccavDecrypt(hex: string, workingKey: string): Promise<string | null> {
  const clean = String(hex || '').trim()
  if (!clean || clean.length % 32 !== 0 || clean.length > 32768 || !/^[0-9a-fA-F]+$/.test(clean)) return null
  const bytes = new Uint8Array(clean.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(clean.substr(i * 2, 2), 16)
  try {
    const out = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: CCAV_IV }, await ccavKey(workingKey, 'decrypt'), bytes)
    const text = new TextDecoder('utf-8', { fatal: true }).decode(out)
    return /[\u0000-\u001f\u007f�]/.test(text) ? null : text
  } catch {
    return null
  }
}

// The request body, encoded the way a browser encodes a form: that is what their
// kits encrypt. Empty values are left out, so the gateway asks for them itself.
export function ccavRequestBody(params: Record<string, string>): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== '' && v != null) q.append(k, String(v))
  return q.toString()
}

// Their answer is `key=value&key=value` with the values as they are, spaces and
// all, so it is split rather than URL-decoded. A key seen twice makes the whole
// answer unusable: there is no honest reason for one, and picking either copy
// would let a pasted block choose which.
export function ccavParseResponse(text: string): Record<string, string> | null {
  const out: Record<string, string> = {}
  for (const pair of String(text || '').split('&')) {
    if (!pair) continue
    const eq = pair.indexOf('=')
    if (eq < 1) continue
    const k = pair.slice(0, eq)
    if (Object.prototype.hasOwnProperty.call(out, k)) return null
    out[k] = pair.slice(eq + 1)
  }
  return out
}
