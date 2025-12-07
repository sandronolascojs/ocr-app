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
import { useDeleteAllUserStorage } from "@/hooks/http"

interface DeleteStorageDialogProps {
  onSuccess?: () => void
}

export const DeleteStorageDialog = ({
  onSuccess,
}: DeleteStorageDialogProps) => {
  const { deleteStorageDialogOpen, setDeleteStorageDialogOpen } =
    useDialogStore()

  const deleteStorageMutation = useDeleteAllUserStorage({
    onSuccess: () => {
      setDeleteStorageDialogOpen(false)
      onSuccess?.()
    },
  })

  const handleDeleteAll = () => {
    deleteStorageMutation.mutate()
  }

  return (
    <Dialog
      open={deleteStorageDialogOpen}
      onOpenChange={setDeleteStorageDialogOpen}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete All Storage</DialogTitle>
          <DialogDescription>
            This action cannot be undone. This will permanently delete all your
            files.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            This will delete all your files including:
          </p>
          <ul className="list-disc list-inside mt-2 space-y-1 text-sm text-muted-foreground">
            <li>All text documents (TXT)</li>
            <li>All Word documents (DOCX)</li>
            <li>All processed image ZIPs</li>
            <li>All thumbnails</li>
          </ul>
          <p className="mt-2 font-semibold text-destructive text-sm">
            Your job history will remain, but all files will be deleted.
          </p>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setDeleteStorageDialogOpen(false)}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleDeleteAll}
            disabled={deleteStorageMutation.isPending}
          >
            {deleteStorageMutation.isPending ? "Deleting..." : "Delete All"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

