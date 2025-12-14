"use client";

import * as React from "react";
import { useMemo, useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod/v3";
import { zodResolver } from "@hookform/resolvers/zod";

import { useUploadZip } from "@/hooks/http/useUploadZip";
import { useOcrJob } from "@/hooks/http/useOcrJob";
import { useRetryOcrJob } from "@/hooks/http/useRetryOcrJob";
import { useRetryFromStep } from "@/hooks/http/useRetryFromStep";
import { useOcrResult } from "@/hooks/http/useOcrResult";
import { useApiKeys, useRemoveSubtitles } from "@/hooks/http";
import { ApiKeyProvider } from "@/types/enums/apiKeyProvider.enum";
import { useSearchParams } from "next/navigation";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ApiKeyAlert } from "@/components/api-key-alert";
import { toast } from "sonner";
import { JobsStatus, JobStep, JobType } from "@/types";
import { downloadSignedUrl, formatBytes } from "@/lib/utils";
import { JobProgressCard } from "@/views/shared/JobProgressCard";

// ---------- Zod schema para el form de upload ----------

const uploadSchema = z.object({
  file: z.custom<File>((file) => file instanceof File)
    .refine((file) => file.name.toLowerCase().endsWith(".zip"), "Only .zip files are allowed"),
});

type UploadFormValues = z.infer<typeof uploadSchema>;

// ---------- Helpers UI ----------

const statusLabel: Record<JobsStatus, string> = {
  [JobsStatus.PENDING]: "Pending",
  [JobsStatus.PROCESSING]: "Processing",
  [JobsStatus.DONE]: "Done",
  [JobsStatus.ERROR]: "Error",
};

const stepLabel: Record<JobStep, string> = {
  [JobStep.PREPROCESSING]: "1) Preprocessing",
  [JobStep.BATCH_SUBMITTED]: "2) Batch submitted",
  [JobStep.RESULTS_SAVED]: "3) Results saved",
  [JobStep.DOCS_BUILT]: "4) Documents built",
};

const statusVariant: Record<JobsStatus, React.ComponentProps<typeof Badge>["variant"]> =
  {
    [JobsStatus.PENDING]: "secondary",
    [JobsStatus.PROCESSING]: "default",
    [JobsStatus.DONE]: "default",
    [JobsStatus.ERROR]: "destructive",
  };

// ---------- Página principal ----------

export const NewJobView = () => {
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
    resetField,
    formState: { errors },
    watch,
  } = form;

  const selectedFile: File | undefined = watch("file");

  // Mutations / queries
  const uploadMutation = useUploadZip();
  const uploadProgress = uploadMutation.uploadProgress;
  const jobQuery = useOcrJob(currentJobId);
  const apiKeysQuery = useApiKeys();
  
  // Check if user has an active OpenAI API key
  // Only compute after query succeeds to ensure consistent behavior
  const apiKeys = apiKeysQuery.data ?? [];
  const hasOpenAiKey = apiKeysQuery.isSuccess && apiKeys.some(
    (key) => key.provider === ApiKeyProvider.OPENAI && key.isActive
  );

  const job = jobQuery.data;
  const retryMutation = useRetryOcrJob({
    currentStep: job?.step ?? null,
  });
  const retryFromStepMutation = useRetryFromStep();
  const removeSubtitlesMutation = useRemoveSubtitles();

  const resultQuery = useOcrResult(
    currentJobId,
    job?.status === JobsStatus.DONE && !!job?.hasResults
  );

  const isProcessing =
    job?.status === JobsStatus.PENDING || job?.status === JobsStatus.PROCESSING;

  // Handlers

  const onSubmit = handleSubmit(async (values: UploadFormValues) => {
    try {
      const { jobId } = await uploadMutation.mutateAsync({ 
        file: values.file,
        jobType: JobType.OCR,
      });
      setCurrentJobId(jobId);
      toast.success("Job created", {
        description: `Job ID: ${jobId}`,
      });
    } catch (error: unknown) {
      console.error(error);
      toast.error("Error uploading ZIP", {
        description:
          error instanceof Error ? error.message : "Unexpected error",
      });
    }
  });

  const handleRetry = async () => {
    if (!currentJobId) return;
      await retryMutation.retryOcrJob({ jobId: currentJobId });
  };

  const handleRetryFromStep = async (step: JobStep) => {
    if (!currentJobId) return;
      await retryFromStepMutation.mutateAsync({ jobId: currentJobId, step });
  };

  const handleDownloadTxt = () => {
    const url = resultQuery.ocrResult?.txt?.url;
    if (!url) return;
    downloadSignedUrl(url);
  };

  const handleDownloadDocx = () => {
    const url = resultQuery.ocrResult?.docx?.url;
    if (!url) return;
    downloadSignedUrl(url);
  };

  const handleDownloadRawZip = () => {
    const url = resultQuery.ocrResult?.rawZip?.url;
    if (!url) return;
    downloadSignedUrl(url);
  };

  const handleDownloadCroppedZip = () => {
    const url = resultQuery.ocrResult?.croppedZip?.url;
    if (!url) return;
    downloadSignedUrl(url);
  };

  // Progress percentage comes from backend
  const progressPct = job?.progressPct ?? 0;

  const formattedUploadProgress = useMemo(() => {
    if (!uploadProgress) return null;
    return {
      loaded: formatBytes(uploadProgress.loaded),
      total: formatBytes(uploadProgress.total),
      percentage: uploadProgress.percentage,
    };
  }, [uploadProgress]);

  const formattedFileSize = useMemo(() => {
    if (!selectedFile) return null;
    return formatBytes(selectedFile.size);
  }, [selectedFile?.size]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-1 flex-col gap-6 overflow-auto">
        <header className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">
            Chinese Subtitle OCR Pipeline
          </h1>
          <p className="text-sm text-muted-foreground">
            Upload a ZIP with frames, let the pipeline run (preprocess, batch
            OCR with GPT-4.1, build TXT & DOCX), and download the extracted
            subtitles.
          </p>
        </header>

        <ApiKeyAlert />

        <div className="grid flex-1 gap-6 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.3fr)]">
          {/* Upload Card */}
          <Card>
            <CardHeader>
              <CardTitle>Upload ZIP</CardTitle>
              <CardDescription>
                Only <span className="font-mono">.zip</span> files containing{" "}
                <span className="font-mono">.png</span> or{" "}
                <span className="font-mono">.jpg</span> images.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-6" onSubmit={onSubmit}>
                <div className="space-y-2">
                  <Label htmlFor="file">ZIP file</Label>
                  <Input
                    id="file"
                    type="file"
                    accept=".zip"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        setValue("file", file, { shouldValidate: true });
                      } else {
                        resetField("file");
                      }
                    }}
                  />
                  {selectedFile && formattedFileSize && (
                    <p className="text-xs text-muted-foreground">
                      Selected:{" "}
                      <span className="font-mono">{selectedFile.name}</span>{" "}
                      ({formattedFileSize})
                    </p>
                  )}
                  {errors.file && (
                    <p className="text-xs text-destructive">
                      {errors.file.message as string}
                    </p>
                  )}
                </div>

                {formattedUploadProgress && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">
                        Uploading...
                      </span>
                      <span className="font-mono">
                        {formattedUploadProgress.percentage}%
                      </span>
                    </div>
                    <Progress value={formattedUploadProgress.percentage} />
                    <p className="text-xs text-muted-foreground">
                      {formattedUploadProgress.loaded} / {formattedUploadProgress.total}
                    </p>
                  </div>
                )}

                <Button
                  type="submit"
                  disabled={uploadMutation.isPending || !selectedFile || !hasOpenAiKey}
                  className="w-full"
                >
                  {uploadMutation.isPending ? "Uploading..." : "Start OCR Job"}
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Job Status Card */}
          <JobProgressCard
            jobId={currentJobId}
            job={job ? {
              jobId: job.jobId,
              jobType: job.jobType,
              status: job.status,
              step: job.step,
              error: job.error,
              totalImages: job.totalImages,
              processedImages: job.processedImages,
              totalBatches: job.totalBatches,
              batchesCompleted: job.batchesCompleted,
              submittedImages: job.submittedImages,
              hasResults: job.hasResults,
              createdAt: job.createdAt,
              updatedAt: job.updatedAt,
            } : null}
            isLoading={jobQuery.isLoading}
            progressPct={progressPct}
            onRetry={handleRetry}
            onRetryFromStep={handleRetryFromStep}
            onDownloadTxt={handleDownloadTxt}
            onDownloadDocx={handleDownloadDocx}
            onDownloadRawZip={handleDownloadRawZip}
            onDownloadCroppedZip={handleDownloadCroppedZip}
            onRemoveSubtitles={() => {
              if (!currentJobId) return;
              removeSubtitlesMutation.mutate({ jobId: currentJobId });
            }}
            canRetry={hasOpenAiKey && !!currentJobId && !isProcessing}
            canDownloadTxt={hasOpenAiKey && !!currentJobId && !!job && job.status === "DONE" && !!job.hasResults && !resultQuery.isLoading && !!resultQuery.ocrResult?.txt}
            canDownloadDocx={hasOpenAiKey && !!currentJobId && !!job && job.status === "DONE" && !!job.hasResults && !resultQuery.isLoading && !!resultQuery.ocrResult?.docx}
            canDownloadRawZip={hasOpenAiKey && !!currentJobId && !!job && job.status === "DONE" && !!job.hasResults && !resultQuery.isLoading && !!resultQuery.ocrResult?.rawZip}
            canDownloadCroppedZip={hasOpenAiKey && !!currentJobId && !!job && job.status === "DONE" && !!job.hasResults && !resultQuery.isLoading && !!resultQuery.ocrResult?.croppedZip}
            canRemoveSubtitles={hasOpenAiKey && !!currentJobId}
            isRetrying={retryMutation.isLoading}
            isRetryingFromStep={retryFromStepMutation.isPending}
            isRemovingSubtitles={removeSubtitlesMutation.isPending}
            hasTxtResult={!!resultQuery.ocrResult?.txt}
            hasDocxResult={!!resultQuery.ocrResult?.docx}
            hasRawZipResult={!!resultQuery.ocrResult?.rawZip}
            hasCroppedZipResult={!!resultQuery.ocrResult?.croppedZip}
          />
        </div>
      </div>
    </div>
  );
};

