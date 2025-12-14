import { SignedDownloadUrl } from "@/lib/storage";

export type DocumentType = "txt" | "docx";

export interface DocumentFile {
  type: DocumentType;
  sizeBytes: number | null;
  url: SignedDownloadUrl | null;
  filesExist: boolean;
}

export interface Document {
  jobId: string;
  txt: DocumentFile | null;
  docx: DocumentFile | null;
  thumbnailUrl: SignedDownloadUrl | null;
  thumbnailKey: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

