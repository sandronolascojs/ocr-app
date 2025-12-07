import { CompactEncrypt, compactDecrypt } from "jose"
import { env } from "@/env.mjs"

/**
 * Minimum length required for the encryption secret (32 characters = 256 bits)
 * This ensures sufficient entropy for secure encryption
 */
const MIN_ENCRYPTION_SECRET_LENGTH = 32

const getEncryptionSecret = (): string => {
  const secret = env.API_KEY_ENCRYPTION_SECRET

  if (!secret) {
    throw new Error(
      `API_KEY_ENCRYPTION_SECRET environment variable is missing or empty. ` +
      `Please set a valid encryption secret with at least ${MIN_ENCRYPTION_SECRET_LENGTH} characters.`
    )
  }

  if (secret.trim().length === 0) {
    throw new Error(
      `API_KEY_ENCRYPTION_SECRET environment variable is empty or contains only whitespace. ` +
      `Please set a valid encryption secret with at least ${MIN_ENCRYPTION_SECRET_LENGTH} characters.`
    )
  }

  if (secret.length < MIN_ENCRYPTION_SECRET_LENGTH) {
    throw new Error(
      `API_KEY_ENCRYPTION_SECRET environment variable is too short (${secret.length} characters). ` +
      `Minimum length required is ${MIN_ENCRYPTION_SECRET_LENGTH} characters for secure encryption. ` +
      `Please update the API_KEY_ENCRYPTION_SECRET environment variable with a longer secret.`
    )
  }

  return secret
}

/**
 * Salt length in bytes for PBKDF2 key derivation
 */
const SALT_LENGTH = 16

/**
 * Derives an encryption key from the secret using PBKDF2 with a provided salt
 */
const getEncryptionKey = async (
  secret: string,
  salt: Uint8Array
): Promise<Uint8Array> => {
  const encoder = new TextEncoder()
  const secretKey = encoder.encode(secret)
  
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    secretKey,
    "PBKDF2",
    false,
    ["deriveBits", "deriveKey"]
  )

  // Create a new ArrayBuffer and copy salt bytes to ensure proper type compatibility
  // This avoids type assertion while ensuring the salt is a proper ArrayBuffer
  const saltBuffer = new ArrayBuffer(salt.length)
  const saltView = new Uint8Array(saltBuffer)
  saltView.set(salt)

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: saltBuffer,
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
 * Generates a cryptographically secure random salt for each encryption
 * Returns the salt (base64url encoded) prepended to the JWE: "{salt}.{jwe}"
 */
export const encryptApiKey = async (
  key: string,
  secret?: string
): Promise<string> => {
  // Generate a cryptographically secure random salt
  const saltBuffer = new Uint8Array(SALT_LENGTH)
  crypto.getRandomValues(saltBuffer)
  const salt = new Uint8Array(saltBuffer)
  
  // Encode salt as base64url (compatible with JWE format)
  const saltBase64Url = btoa(String.fromCharCode(...salt))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "")
  
  try {
    const encryptionSecret = secret ?? getEncryptionSecret()
    const encryptionKey = await getEncryptionKey(encryptionSecret, salt)
    const jwe = await new CompactEncrypt(new TextEncoder().encode(key))
      .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
      .encrypt(encryptionKey)

    // Prepend salt to JWE: "{salt}.{jwe}"
    return `${saltBase64Url}.${jwe}`
  } catch (error) {
    // Log sanitized error message without exposing implementation details
    console.error("Encryption failed: An error occurred during the encryption process")
    
    // Throw generic error to prevent leaking implementation details or stack traces
    throw new Error("Encryption failed")
  }
}

/**
 * Decrypts an API key using JWE
 * Extracts the prepended salt from the encrypted key format: "{salt}.{jwe}"
 */
export const decryptApiKey = async (
  encryptedKey: string,
  secret?: string
): Promise<string> => {
  // Extract salt and JWE from format: "{salt}.{jwe}"
  const dotIndex = encryptedKey.indexOf(".")
  
  if (dotIndex === -1) {
    // Legacy format: try to decrypt without salt extraction (for backward compatibility)
    // This handles old encrypted keys that don't have prepended salt
    try {
      const decryptionSecret = secret ?? getEncryptionSecret()
      // Use a default salt for legacy keys (this is a fallback only)
      const legacySalt = new TextEncoder().encode("api-key-encryption-salt")
      const decryptionKey = await getEncryptionKey(decryptionSecret, legacySalt)
      const { plaintext } = await compactDecrypt(encryptedKey, decryptionKey)
      return new TextDecoder().decode(plaintext)
    } catch (error) {
      // Log original error details for debugging
      console.error("Decryption failed (legacy format):", error instanceof Error ? error.message : String(error))
      // Throw sanitized error without exposing implementation details
      throw new Error("Failed to decrypt API key")
    }
  }
  
  // Extract salt (base64url encoded) and JWE
  const saltBase64Url = encryptedKey.substring(0, dotIndex)
  const jwe = encryptedKey.substring(dotIndex + 1)
  
  // Decode salt from base64url
  // Add padding if needed (base64url may not have padding)
  let saltBase64 = saltBase64Url.replace(/-/g, "+").replace(/_/g, "/")
  // Add padding to make it valid base64
  while (saltBase64.length % 4 !== 0) {
    saltBase64 += "="
  }
  const saltBytes = Uint8Array.from(
    atob(saltBase64),
    (c) => c.charCodeAt(0)
  )
  
  // Validate salt length
  if (saltBytes.length !== SALT_LENGTH) {
    throw new Error(
      `Invalid salt length: expected ${SALT_LENGTH} bytes, got ${saltBytes.length}`
    )
  }
  
  try {
    const decryptionSecret = secret ?? getEncryptionSecret()
    const decryptionKey = await getEncryptionKey(decryptionSecret, saltBytes)
    const { plaintext } = await compactDecrypt(jwe, decryptionKey)
    return new TextDecoder().decode(plaintext)
  } catch (error) {
    // Log original error details for debugging
    console.error("Decryption failed:", error instanceof Error ? error.message : String(error))
    // Throw sanitized error without exposing implementation details
    throw new Error("Failed to decrypt API key")
  }
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

