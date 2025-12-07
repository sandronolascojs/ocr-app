import { z } from "zod"
import { createTRPCRouter, protectedProcedure } from "@/trpc/init"
import { apiKeys } from "@/db/schema"
import { eq, and, desc } from "drizzle-orm"
import { TRPCError } from "@trpc/server"
import { ApiKeyProvider } from "@/types/enums/apiKeyProvider.enum"
import { encryptApiKey, decryptApiKey, maskApiKey } from "@/lib/encryption"

export const apiKeysRouter = createTRPCRouter({
  getApiKeys: protectedProcedure.query(async ({ ctx }) => {
    const keys = await ctx.db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.userId, ctx.userId))
      .orderBy(desc(apiKeys.createdAt))

    return keys.map((key) => ({
      id: key.id,
      provider: key.provider,
      keyPrefix: key.keyPrefix,
      keySuffix: key.keySuffix,
      isActive: key.isActive,
      createdAt: key.createdAt,
      updatedAt: key.updatedAt,
    }))
  }),

  createApiKey: protectedProcedure
    .input(
      z.object({
        provider: z.enum(ApiKeyProvider),
        key: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { provider, key } = input

      // Validate OpenAI API key format
      if (provider === ApiKeyProvider.OPENAI && !key.startsWith("sk-")) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "OpenAI API key must start with 'sk-'",
        })
      }

      // Encrypt the key
      const encryptedKey = await encryptApiKey(key)

      // Mask the key for display
      const { prefix, suffix } = maskApiKey(key)

      // Deactivate all other keys for this provider
      await ctx.db
        .update(apiKeys)
        .set({ isActive: false })
        .where(
          and(
            eq(apiKeys.userId, ctx.userId),
            eq(apiKeys.provider, provider)
          )
        )

      // Create new API key
      const [newKey] = await ctx.db
        .insert(apiKeys)
        .values({
          userId: ctx.userId,
          provider,
          encryptedKey,
          keyPrefix: prefix,
          keySuffix: suffix,
          isActive: true,
        })
        .returning()

      return {
        id: newKey.id,
        provider: newKey.provider,
        keyPrefix: newKey.keyPrefix,
        keySuffix: newKey.keySuffix,
        isActive: newKey.isActive,
        createdAt: newKey.createdAt,
      }
    }),

  updateApiKey: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        key: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, key } = input

      // Verify ownership
      const [existingKey] = await ctx.db
        .select()
        .from(apiKeys)
        .where(
          and(eq(apiKeys.id, id), eq(apiKeys.userId, ctx.userId))
        )
        .limit(1)

      if (!existingKey) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "API key not found",
        })
      }

      // Validate format based on provider
      if (
        existingKey.provider === ApiKeyProvider.OPENAI &&
        !key.startsWith("sk-")
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "OpenAI API key must start with 'sk-'",
        })
      }

      // Encrypt the new key
      const encryptedKey = await encryptApiKey(key)
      const { prefix, suffix } = maskApiKey(key)

      // Update the key
      const [updatedKey] = await ctx.db
        .update(apiKeys)
        .set({
          encryptedKey,
          keyPrefix: prefix,
          keySuffix: suffix,
        })
        .where(eq(apiKeys.id, id))
        .returning()

      return {
        id: updatedKey.id,
        provider: updatedKey.provider,
        keyPrefix: updatedKey.keyPrefix,
        keySuffix: updatedKey.keySuffix,
        isActive: updatedKey.isActive,
        updatedAt: updatedKey.updatedAt,
      }
    }),

  deleteApiKey: protectedProcedure
    .input(
      z.object({
        id: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify ownership
      const [existingKey] = await ctx.db
        .select()
        .from(apiKeys)
        .where(
          and(eq(apiKeys.id, input.id), eq(apiKeys.userId, ctx.userId))
        )
        .limit(1)

      if (!existingKey) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "API key not found",
        })
      }

      await ctx.db.delete(apiKeys).where(eq(apiKeys.id, input.id))

      return { success: true }
    }),

  setActiveApiKey: protectedProcedure
    .input(
      z.object({
        id: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify ownership
      const [existingKey] = await ctx.db
        .select()
        .from(apiKeys)
        .where(
          and(eq(apiKeys.id, input.id), eq(apiKeys.userId, ctx.userId))
        )
        .limit(1)

      if (!existingKey) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "API key not found",
        })
      }

      // Deactivate all keys for this provider
      await ctx.db
        .update(apiKeys)
        .set({ isActive: false })
        .where(
          and(
            eq(apiKeys.userId, ctx.userId),
            eq(apiKeys.provider, existingKey.provider)
          )
        )

      // Activate the selected key
      const [updatedKey] = await ctx.db
        .update(apiKeys)
        .set({ isActive: true })
        .where(eq(apiKeys.id, input.id))
        .returning()

      return {
        id: updatedKey.id,
        provider: updatedKey.provider,
        keyPrefix: updatedKey.keyPrefix,
        keySuffix: updatedKey.keySuffix,
        isActive: updatedKey.isActive,
      }
    }),

  getActiveApiKey: protectedProcedure
    .input(
      z.object({
        provider: z.nativeEnum(ApiKeyProvider),
      })
    )
    .query(async ({ ctx, input }) => {
      const [activeKey] = await ctx.db
        .select()
        .from(apiKeys)
        .where(
          and(
            eq(apiKeys.userId, ctx.userId),
            eq(apiKeys.provider, input.provider),
            eq(apiKeys.isActive, true)
          )
        )
        .limit(1)

      if (!activeKey) {
        return null
      }

      // Decrypt the key (only for server-side use)
      const decryptedKey = await decryptApiKey(activeKey.encryptedKey)

      return {
        id: activeKey.id,
        provider: activeKey.provider,
        key: decryptedKey,
      }
    }),
})

