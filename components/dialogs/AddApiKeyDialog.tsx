"use client"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useDialogStore } from "@/store/dialogs"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod/v3"
import { ApiKeyProvider } from "@/types/enums/apiKeyProvider.enum"
import { useEffect } from "react"
import { useApiKeys, useCreateApiKey } from "@/hooks/http"

const apiKeySchema = z.object({
  key: z
    .string()
    .min(1, "API key is required")
    .refine((key) => key.startsWith("sk-"), {
      message: "OpenAI API key must start with 'sk-'",
    }),
})

type ApiKeyFormValues = z.infer<typeof apiKeySchema>

export const AddApiKeyDialog = () => {
  const { addApiKeyDialogOpen, setAddApiKeyDialogOpen } = useDialogStore()
  const apiKeysQuery = useApiKeys()

  const form = useForm<ApiKeyFormValues>({
    resolver: zodResolver(apiKeySchema),
    defaultValues: {
      key: "",
    },
  })

  const createMutation = useCreateApiKey({
    onSuccess: () => {
      setAddApiKeyDialogOpen(false)
      form.reset()
    },
    onError: (error) => {
      // Log error for debugging
      console.error("Failed to create API key:", error)
      
      // Set form error for user-facing feedback
      const errorMessage = error.message || "Failed to add API key. Please try again."
      form.setError("key", {
        type: "server",
        message: errorMessage,
      })
    },
  })

  const onSubmit = form.handleSubmit((values) => {
    createMutation.mutate({
      provider: ApiKeyProvider.OPENAI,
      key: values.key,
    })
  })

  useEffect(() => {
    if (!addApiKeyDialogOpen) {
      form.reset()
    }
  }, [addApiKeyDialogOpen, form])

  return (
    <Dialog open={addApiKeyDialogOpen} onOpenChange={setAddApiKeyDialogOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add OpenAI API Key</DialogTitle>
          <DialogDescription>
            Enter your OpenAI API key. It will be encrypted and stored securely.
            {apiKeysQuery.data && apiKeysQuery.data.length > 0 && (
              <span> This will become your active key.</span>
            )}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="apiKey">OpenAI API Key</Label>
            <Input
              id="apiKey"
              type="password"
              placeholder="sk-..."
              {...form.register("key")}
            />
            {form.formState.errors.key && (
              <p className="text-xs text-destructive">
                {form.formState.errors.key.message}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setAddApiKeyDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Adding..." : "Add Key"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

