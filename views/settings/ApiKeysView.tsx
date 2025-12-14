"use client"

import * as React from "react"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Key, Trash2, Plus, AlertTriangle } from "lucide-react"
import { ApiKeyProvider } from "@/types/enums/apiKeyProvider.enum"
import { useDialogStore } from "@/store/dialogs"
import { useApiKeys } from "@/hooks/http"

export const ApiKeysView = () => {
  const { setAddApiKeyDialogOpen, setDeleteApiKeyDialogOpen } = useDialogStore()
  const apiKeysQuery = useApiKeys()

  const apiKeys = apiKeysQuery.data ?? []
  const openaiKeys = apiKeys.filter(
    (key) => key.provider === ApiKeyProvider.OPENAI
  )
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">API Keys</h1>
        <p className="text-sm text-muted-foreground">
          Manage your API keys securely. Keys are encrypted and never exposed.
        </p>
      </div>

      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          Your API keys are encrypted and stored securely. They are never
          exposed in the UI or logs. Only masked versions are shown.
        </AlertDescription>
      </Alert>

      {apiKeysQuery.isLoading && (
        <Card>
          <CardContent className="py-8">
            <p className="text-sm text-muted-foreground text-center">
              Loading API keys...
            </p>
          </CardContent>
        </Card>
      )}

      {apiKeysQuery.isError && (
        <Card>
          <CardContent className="py-8">
            <p className="text-sm text-destructive text-center">
              Failed to load API keys:{" "}
              {apiKeysQuery.error?.message ?? "Unknown error"}
            </p>
          </CardContent>
        </Card>
      )}

      {!apiKeysQuery.isLoading &&
        !apiKeysQuery.isError &&
        openaiKeys.length === 0 && (
          <Card>
            <CardHeader>
              <CardTitle>No API Keys</CardTitle>
              <CardDescription>
                You need to add an OpenAI API key to create OCR jobs.
              </CardDescription>
            </CardHeader>
            <CardFooter>
              <Button onClick={() => setAddApiKeyDialogOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Add API Key
              </Button>
            </CardFooter>
          </Card>
        )}

      {!apiKeysQuery.isLoading &&
        !apiKeysQuery.isError &&
        openaiKeys.length > 0 && (
          <div className="space-y-4">
            {openaiKeys.map((apiKey) => (
              <Card key={apiKey.id}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1 flex-1">
                      <div className="flex items-center gap-2">
                        <Key className="h-4 w-4 text-muted-foreground" />
                        <CardTitle className="text-base">
                          OpenAI API Key
                        </CardTitle>
                      </div>
                      <CardDescription className="font-mono text-sm">
                        {apiKey.keyPrefix}...{apiKey.keySuffix}
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      {apiKey.isActive && (
                        <Badge variant="default">Active</Badge>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeleteApiKeyDialogOpen(apiKey.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Provider:</span>
                      <span className="font-medium">OpenAI</span>
                    </div>
                    {apiKey.createdAt && (
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Created:</span>
                        <span className="font-medium">
                          {new Date(apiKey.createdAt).toLocaleString()}
                        </span>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}

            <Button
              variant="outline"
              className="w-full"
              onClick={() => setAddApiKeyDialogOpen(true)}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Another API Key
            </Button>
          </div>
        )}
    </div>
  )
}

