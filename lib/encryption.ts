import { CompactEncrypt, compactDecrypt } from "jose"
import { env } from "@/env.mjs"

const getEncryptionSecret = (): string => {
  return env.API_KEY_ENCRYPTION_SECRET
}

/**
 * Derives an encryption key from the secret using PBKDF2
 */
const getEncryptionKey = async (secret: string): Promise<Uint8Array> => {
  const encoder = new TextEncoder()
  const secretKey = encoder.encode(secret)
  
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    secretKey,
    "PBKDF2",
    false,
    ["deriveBits", "deriveKey"]
  )

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: encoder.encode("api-key-encryption-salt"),
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    256
  )

  return new Uint8Array(derivedBits)
}

/**
 * Encrypts an API key using JWE with AES-256-GCM
 */
export const encryptApiKey = async (
  key: string,
  secret?: string
): Promise<string> => {
  const encryptionSecret = secret ?? getEncryptionSecret()
  const encryptionKey = await getEncryptionKey(encryptionSecret)
  const jwe = await new CompactEncrypt(new TextEncoder().encode(key))
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .encrypt(encryptionKey)

  return jwe
}

/**
 * Decrypts an API key using JWE
 */
export const decryptApiKey = async (
  encryptedKey: string,
  secret?: string
): Promise<string> => {
  const decryptionSecret = secret ?? getEncryptionSecret()
  const decryptionKey = await getEncryptionKey(decryptionSecret)
  const { plaintext } = await compactDecrypt(encryptedKey, decryptionKey)
  return new TextDecoder().decode(plaintext)
}

/**
 * Masks an API key to show only prefix and suffix
 * Returns the first 6 characters and last 4 characters
 */
export const maskApiKey = (key: string): { prefix: string; suffix: string } => {
  if (key.length <= 10) {
    // If key is too short, just show dots
    return { prefix: "***", suffix: "***" }
  }

  const prefix = key.substring(0, 6)
  const suffix = key.substring(key.length - 4)

  return { prefix, suffix }
}

