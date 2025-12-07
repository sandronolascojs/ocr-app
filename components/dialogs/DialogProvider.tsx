"use client"

import { DeleteStorageDialog } from "./DeleteStorageDialog"
import { DeleteApiKeyDialog } from "./DeleteApiKeyDialog"
import { AddApiKeyDialog } from "./AddApiKeyDialog"

interface DialogProviderProps {
  children: React.ReactNode
}

export const DialogProvider = ({ children }: DialogProviderProps) => {
  return (
    <>
      {children}
      <DeleteStorageDialog />
      <DeleteApiKeyDialog />
      <AddApiKeyDialog />
    </>
  )
}

