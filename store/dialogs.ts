import { create } from "zustand"

interface DialogState {
  deleteStorageDialogOpen: boolean
  setDeleteStorageDialogOpen: (open: boolean) => void

  deleteApiKeyDialogOpen: string | null
  setDeleteApiKeyDialogOpen: (id: string | null) => void

  addApiKeyDialogOpen: boolean
  setAddApiKeyDialogOpen: (open: boolean) => void
}

export const useDialogStore = create<DialogState>((set) => ({
  deleteStorageDialogOpen: false,
  setDeleteStorageDialogOpen: (open) =>
    set({ deleteStorageDialogOpen: open }),

  deleteApiKeyDialogOpen: null,
  setDeleteApiKeyDialogOpen: (id) => set({ deleteApiKeyDialogOpen: id }),

  addApiKeyDialogOpen: false,
  setAddApiKeyDialogOpen: (open) => set({ addApiKeyDialogOpen: open }),
}))

