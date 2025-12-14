"use client";

import * as React from "react";
import { useMemo, useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod/v3";
import { zodResolver } from "@hookform/resolvers/zod";

import { useUploadZip } from "@/hooks/http/useUploadZip";
import { useRemoveSubtitles } from "@/hooks/http";
import { useSearchParams } from "next/navigation";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { JobsStatus, JobType } from "@/types";
import { downloadSignedUrl, formatBytes } from "@/lib/utils";
import { JobProgressCard } from "@/views/shared/JobProgressCard";
import { useOcrJob } from "@/hooks/http/useOcrJob";

// ---------- Zod schema para el form de upload ----------

const uploadSchema = z.object({
  file: z.custom<File>((file) => file instanceof File)
    .refine((file) => file.name.toLowerCase().endsWith(".zip"), "Only .zip files are allowed"),
});

type UploadFormValues = z.infer<typeof uploadSchema>;

// ---------- Helpers UI ----------


// ---------- Página principal ----------

export const SubtitleRemovalView = () => {
  const searchParams = useSearchParams()
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);

  // Load job from URL query param if present
  useEffect(() => {
    const jobIdFromUrl = searchParams.get("jobId")
    if (jobIdFromUrl) {
      setCurrentJobId(jobIdFromUrl)
    }
  }, [searchParams])

  // Form de upload
  const form = useForm<UploadFormValues>({
    resolver: zodResolver(uploadSchema),
  });

  const {
    handleSubmit,
    setValue,
    formState: { errors },
    watch,
  } = form;

  const selectedFile: File | undefined = watch("file");

  // Mutations / queries
  const uploadMutation = useUploadZip();
  const removeSubtitlesMutation = useRemoveSubtitles();

  // Get current job if jobId is set (using the same hook as OCR jobs for consistency)
  const jobQuery = useOcrJob(currentJobId);
  const currentJob = jobQuery.data;

  // File size formatting
  const fileSizeFormatted = useMemo(() => {
    if (!selectedFile) return null;
    return formatBytes(selectedFile.size);
  }, [selectedFile]);

  // Upload progress
  const uploadProgress = useMemo(() => {
    return uploadMutation.uploadProgress;
  }, [uploadMutation.uploadProgress]);

  // Handle file selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setValue("file", file);
    }
  };

  // Handle form submission
  const onSubmit = async (data: UploadFormValues) => {
    try {
      // Upload ZIP with SUBTITLE_REMOVAL job type - this will create the job and trigger the correct event
      const uploadResult = await uploadMutation.mutateAsync({ 
        file: data.file,
        jobType: JobType.SUBTITLE_REMOVAL,
      });
      
      if (!uploadResult?.jobId) {
        throw new Error("Failed to upload ZIP file");
      }

      // Set the current job ID to show progress
      setCurrentJobId(uploadResult.jobId);
      toast.success("Subtitle removal job created successfully");
    } catch (error) {
      console.error("Failed to create subtitle removal job:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to create subtitle removal job"
      );
    }
  };

  // Handle download cropped ZIP
  const handleDownloadCroppedZip = () => {
    const croppedZipUrl = currentJob?.croppedZipUrl;
    if (croppedZipUrl) {
      downloadSignedUrl(croppedZipUrl.url);
    }
  };

  // Progress percentage comes from backend
  const progressPct = currentJob?.progressPct ?? 0;

  const croppedZipUrl = currentJob?.croppedZipUrl;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-1 flex-col gap-6 overflow-auto">
        <header className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">
            Subtitle Removal
          </h1>
          <p className="text-sm text-muted-foreground">
            Remove subtitles from video frames by uploading a ZIP file or selecting an existing OCR job
          </p>
        </header>

        <div className="grid flex-1 gap-6 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.3fr)]">
        {/* Upload Section */}
        <Card>
          <CardHeader>
            <CardTitle>Upload ZIP File</CardTitle>
            <CardDescription>
              Upload a ZIP file containing video frames to remove subtitles
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="file">ZIP File</Label>
                <Input
                  id="file"
                  type="file"
                  accept=".zip"
                  onChange={handleFileChange}
                  disabled={uploadMutation.isPending}
                />
                {errors.file && (
                  <p className="text-sm text-destructive">{errors.file.message}</p>
                )}
                {selectedFile && (
                  <div className="text-sm text-muted-foreground">
                    Selected: {selectedFile.name} ({fileSizeFormatted})
                  </div>
                )}
              </div>

              {uploadProgress && uploadProgress.total > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span>Uploading...</span>
                    <span className="font-mono">
                      {formatBytes(uploadProgress.loaded)} / {formatBytes(uploadProgress.total)} ({uploadProgress.percentage}%)
                    </span>
                  </div>
                  <Progress value={uploadProgress.percentage} />
                </div>
              )}

              <Button
                type="submit"
                disabled={!selectedFile || uploadMutation.isPending || removeSubtitlesMutation.isPending}
              >
                {uploadMutation.isPending || removeSubtitlesMutation.isPending
                  ? "Processing..."
                  : "Start Subtitle Removal"}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Job Progress Section - Always show */}
        <JobProgressCard
        jobId={currentJobId}
        job={currentJob ? {
          jobId: currentJob.jobId,
          jobType: currentJob.jobType,
          status: currentJob.status,
          step: currentJob.step,
          error: currentJob.error,
          totalImages: currentJob.totalImages,
          processedImages: currentJob.processedImages,
          totalBatches: currentJob.totalBatches,
          batchesCompleted: currentJob.batchesCompleted,
          submittedImages: currentJob.submittedImages,
          hasResults: currentJob.hasResults,
          createdAt: currentJob.createdAt,
          updatedAt: currentJob.updatedAt,
        } : null}
        isLoading={jobQuery.isLoading}
        progressPct={progressPct}
        onDownloadCroppedZip={handleDownloadCroppedZip}
        canDownloadCroppedZip={!!currentJobId && !!currentJob && currentJob.status === JobsStatus.DONE && !!croppedZipUrl && !jobQuery.isLoading}
        hasCroppedZipResult={!!croppedZipUrl}
        />
        </div>
      </div>
    </div>
  );
};

