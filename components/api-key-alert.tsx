"use client";

import * as React from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { useApiKeys } from "@/hooks/http";
import { ApiKeyProvider } from "@/types/enums/apiKeyProvider.enum";

export const ApiKeyAlert = () => {
  const apiKeysQuery = useApiKeys();

  const apiKeys = apiKeysQuery.data ?? [];
  const hasOpenAiKey = apiKeys.some(
    (key) => key.provider === ApiKeyProvider.OPENAI && key.isActive
  );

  if (hasOpenAiKey) {
    return null;
  }

  return (
    <Alert variant="destructive" className="border-destructive/50 bg-destructive/10">
      <AlertTriangle className="h-5 w-5 text-destructive" />
      <AlertTitle className="text-base font-semibold text-destructive">
        OpenAI API Key Required
      </AlertTitle>
      <AlertDescription className="text-sm text-destructive/90">
        You need to add an OpenAI API key to use the OCR processing feature.
        <br />
        <Link
          href="/settings/api-keys"
          className="mt-2 inline-flex items-center font-semibold text-destructive underline underline-offset-4 transition-colors hover:text-destructive/80"
        >
          Go to Settings → API Keys
        </Link>{" "}
        to add your API key.
      </AlertDescription>
    </Alert>
  );
};

