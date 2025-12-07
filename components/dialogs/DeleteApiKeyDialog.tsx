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
import { useDialogStore } from "@/store/dialogs"
import { useDeleteApiKey } from "@/hooks/http"

export const DeleteApiKeyDialog = () => {
  const { deleteApiKeyDialogOpen, setDeleteApiKeyDialogOpen } =
    useDialogStore()
  const apiKeyId = deleteApiKeyDialogOpen

  const deleteMutation = useDeleteApiKey({
    onSuccess: () => {
      setDeleteApiKeyDialogOpen(null)
    },
    onError: (error) => {
      // Show error toast/message to user
      console.error("Failed to delete API key:", error)
    },
  })

  const handleDelete = () => {
    if (apiKeyId) {
      deleteMutation.mutate({ id: apiKeyId })
    }
  }

  return (
    <Dialog
      open={deleteApiKeyDialogOpen !== null}
      onOpenChange={(open) => setDeleteApiKeyDialogOpen(open ? apiKeyId : null)}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete API Key</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete this API key? This action cannot be
            undone. You will need to add a new key to create OCR jobs.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setDeleteApiKeyDialogOpen(null)}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={deleteMutation.isPending}
          >
            {deleteMutation.isPending ? "Deleting..." : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

