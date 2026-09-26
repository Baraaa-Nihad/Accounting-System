import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto'

/**
 * تشفير كلمات المرور باتجاه واحد بخوارزمية scrypt (موصى بها من OWASP)
 * مع Salt عشوائي لكل مستخدم. الصيغة المخزنة:
 * scrypt$N$r$p$salt(base64)$hash(base64)
 */

const N = 2 ** 15
const R = 8
const P = 1
const KEYLEN = 64
const MAXMEM = 64 * 1024 * 1024

function scrypt(password: string, salt: Buffer, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key)))
  })
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const hash = await scrypt(password.normalize('NFKC'), salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM })
  return ['scrypt', N, R, P, salt.toString('base64'), hash.toString('base64')].join('$')
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [, n, r, p, saltB64, hashB64] = parts
  const expected = Buffer.from(hashB64, 'base64')
  const actual = await scrypt(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: MAXMEM,
  })
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

/** قواعد كلمة المرور: 8 أحرف على الأقل، وتحتوي حرفًا ورقمًا. */
export function passwordProblem(password: string): string | null {
  if (password.length < 8) return 'كلمة المرور يجب ألا تقل عن 8 أحرف'
  if (password.length > 128) return 'كلمة المرور طويلة جدًا'
  if (!/\d/.test(password) || !/[^\d\s]/.test(password)) return 'كلمة المرور يجب أن تحتوي على أحرف وأرقام'
  return null
}

// هاش ثابت يُستخدم عند عدم وجود المستخدم حتى يستغرق التحقق نفس الوقت (منع كشف أسماء المستخدمين بالتوقيت)
let dummyHash: Promise<string> | null = null
export function getDummyHash(): Promise<string> {
  if (!dummyHash) dummyHash = hashPassword(randomBytes(12).toString('hex'))
  return dummyHash
}
