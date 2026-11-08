import { countHits } from './guessGame'

/**
 * 对方题面：
 * - 运行时只在内存 vault，不进 React / 明文 localStorage
 * - 刷新：AES-GCM 密文 + 不可导出密钥进 IndexedDB，启动时再解回内存
 * - 线路：WebRTC DTLS；普通抓包 / Application 看不到明文答案
 */
const vault = new Map<string, string>()

const DB_NAME = 'between-us-guess-vault'
const DB_VERSION = 1
const STORE = 'peer-secret'

type StoredBlob = {
  roomCode: string
  iv: ArrayBuffer
  cipher: ArrayBuffer
  key: CryptoKey
}

function keyOf(roomCode: string) {
  return roomCode.trim()
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onerror = () => reject(req.error ?? new Error('idb open failed'))
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'roomCode' })
      }
    }
    req.onsuccess = () => resolve(req.result)
  })
}

function idbGet(roomCode: string): Promise<StoredBlob | undefined> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly')
        const req = tx.objectStore(STORE).get(roomCode)
        req.onerror = () => reject(req.error ?? new Error('idb get failed'))
        req.onsuccess = () => resolve(req.result as StoredBlob | undefined)
        tx.oncomplete = () => db.close()
      }),
  )
}

function idbPut(row: StoredBlob): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite')
        tx.objectStore(STORE).put(row)
        tx.onerror = () => reject(tx.error ?? new Error('idb put failed'))
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
      }),
  )
}

function idbDelete(roomCode: string): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite')
        tx.objectStore(STORE).delete(roomCode)
        tx.onerror = () => reject(tx.error ?? new Error('idb delete failed'))
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
      }),
  )
}

async function encryptAndPersist(roomCode: string, secret: string) {
  if (typeof indexedDB === 'undefined' || typeof crypto?.subtle === 'undefined') {
    return
  }
  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(secret),
  )
  await idbPut({
    roomCode,
    iv: iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength),
    cipher,
    key,
  })
}

async function loadIntoVault(roomCode: string): Promise<boolean> {
  if (vault.has(roomCode)) return true
  if (typeof indexedDB === 'undefined' || typeof crypto?.subtle === 'undefined') {
    return false
  }
  try {
    const row = await idbGet(roomCode)
    if (!row?.key || !row.iv || !row.cipher) return false
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(row.iv) },
      row.key,
      row.cipher,
    )
    vault.set(roomCode, new TextDecoder().decode(plain))
    return true
  } catch {
    return false
  }
}

/** 写入内存，并异步加密落盘（刷新可恢复） */
export function stashPeerSecret(roomCode: string, secret: string) {
  const key = keyOf(roomCode)
  if (!key || !secret) return
  vault.set(key, secret)
  void encryptAndPersist(key, secret).catch(() => {
    /* 落盘失败仍可用本次会话内存判分 */
  })
}

/** 刷新后调用：从 IndexedDB 解回内存 */
export async function hydratePeerSecret(roomCode: string): Promise<boolean> {
  const key = keyOf(roomCode)
  if (!key) return false
  if (vault.has(key)) return true
  return loadIntoVault(key)
}

export function clearStashedPeerSecret(roomCode: string) {
  const key = keyOf(roomCode)
  if (!key) return
  vault.delete(key)
  void idbDelete(key).catch(() => {})
}

export function hasStashedPeerSecret(roomCode: string) {
  const key = keyOf(roomCode)
  return !!key && vault.has(key)
}

/** 本地判命中；不把题面返回给调用方 */
export function scoreAgainstPeerSecret(
  roomCode: string,
  guess: string,
): number | null {
  const key = keyOf(roomCode)
  if (!key) return null
  const secret = vault.get(key)
  if (!secret) return null
  return countHits(secret, guess)
}

/** 仅终局展示用 */
export function peekStashedPeerSecret(roomCode: string): string | null {
  const key = keyOf(roomCode)
  if (!key) return null
  return vault.get(key) ?? null
}
