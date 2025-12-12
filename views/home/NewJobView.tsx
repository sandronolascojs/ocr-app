"use client";

import * as React from "react";
import { useMemo, useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod/v3";
import { zodResolver } from "@hookform/resolvers/zod";

import { useUploadOcrZip } from "@/hooks/http/useUploadZip";
import { useOcrJob } from "@/hooks/http/useOcrJob";
import { useRetryOcrJob } from "@/hooks/http/useRetryOcrJob";
import { useRetryFromStep } from "@/hooks/http/useRetryFromStep";
import { useOcrResult } from "@/hooks/http/useOcrResult";
import { useApiKeys } from "@/hooks/http";
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
import { JobsStatus, JobStep } from "@/types";
import { downloadSignedUrl, formatBytes } from "@/lib/utils";

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
    PENDING: "secondary",
    PROCESSING: "default",
    DONE: "default",
    ERROR: "destructive",
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
  const uploadMutation = useUploadOcrZip();
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

  const resultQuery = useOcrResult(
    currentJobId,
    job?.status === JobsStatus.DONE && !!job?.hasResults
  );

  const isProcessing =
    job?.status === JobsStatus.PENDING || job?.status === JobsStatus.PROCESSING;

  // Handlers

  const onSubmit = handleSubmit(async (values: UploadFormValues) => {
    try {
      const { jobId } = await uploadMutation.mutateAsync({ file: values.file });
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

  const progressPct = useMemo(() => {
    if (!job?.totalImages || job.totalImages === 0) return 0;
    return Math.round(((job.processedImages ?? 0) / job.totalImages) * 100);
  }, [job?.processedImages, job?.totalImages]);

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
          <Card className="flex flex-col">
            <CardHeader className="flex flex-row items-start justify-between gap-2">
              <div className="space-y-1">
                <CardTitle>Job status</CardTitle>
                <CardDescription className="break-all">
                  {currentJobId ? (
                    <>
                      Job ID:{" "}
                      <span className="font-mono text-xs">
                        {currentJobId}
                      </span>
                    </>
                  ) : (
                    "Upload a ZIP to start a new job."
                  )}
                </CardDescription>
              </div>
              {job?.status && (
                <Badge variant={statusVariant[job.status]}>
                  {statusLabel[job.status]}
                </Badge>
              )}
            </CardHeader>

            <CardContent className="flex-1 flex flex-col gap-4">
              {jobQuery.isLoading && !job && currentJobId && (
                <p className="text-sm text-muted-foreground">
                  Loading job info...
                </p>
              )}

              {!currentJobId && (
                <p className="text-sm text-muted-foreground">
                  No job selected. Upload a ZIP to start a new job or go to History to load an existing job.
                </p>
              )}

              {job && (
                <>
                  {/* Steps timeline */}
                  <div className="space-y-3">
                    <p className="text-xs font-medium uppercase text-muted-foreground">
                      Pipeline steps
                    </p>
                    <div className="space-y-2">
                      {(
                        [
                          JobStep.PREPROCESSING,
                          JobStep.BATCH_SUBMITTED,
                          JobStep.RESULTS_SAVED,
                          JobStep.DOCS_BUILT,
                        ] as JobStep[]
                      ).map((s) => {
                        const isActive = job.step === s;
                        const isCompleted =
                          (job.step === JobStep.BATCH_SUBMITTED && s === JobStep.PREPROCESSING) ||
                          (job.step === JobStep.RESULTS_SAVED &&
                            (s === JobStep.PREPROCESSING ||
                              s === JobStep.BATCH_SUBMITTED)) ||
                          (job.step === JobStep.DOCS_BUILT &&
                            (s === JobStep.PREPROCESSING ||
                              s === JobStep.BATCH_SUBMITTED ||
                              s === JobStep.RESULTS_SAVED)) ||
                          job.status === JobsStatus.DONE;
                        const isFailed = job.status === JobsStatus.ERROR;
                        const canRetryFromStep = isFailed && !isCompleted;

                        const rightInfo =
                          s === JobStep.PREPROCESSING
                            ? `${job.totalImages ?? 0} images`
                            : s === JobStep.BATCH_SUBMITTED
                              ? `${job.batchesCompleted ?? 0} / ${job.totalBatches ?? 0} batches`
                              : null;

                        return (
                          <div
                            key={s}
                            className="flex items-center justify-between rounded-md border px-3 py-2 text-xs"
                          >
                            <div className="flex items-center gap-2">
                              <div
                                className={`h-2 w-2 rounded-full ${
                                  isCompleted
                                    ? "bg-emerald-500"
                                    : isActive
                                    ? "bg-primary"
                                    : "bg-muted-foreground/40"
                                }`}
                              />
                              <span className="font-medium">
                                {stepLabel[s]}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              {rightInfo && (
                                <span className="font-mono text-[10px] text-muted-foreground">
                                  {rightInfo}
                                </span>
                              )}
                              {isCompleted && (
                                <Badge variant="outline" className="text-[10px]">
                                  done
                                </Badge>
                              )}
                              {!isCompleted && isActive && (
                                <Badge
                                  variant="outline"
                                  className="text-[10px]"
                                >
                                  running
                                </Badge>
                              )}
                              {canRetryFromStep && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-2 text-[10px]"
                                  onClick={() => handleRetryFromStep(s)}
                                  disabled={
                                    !hasOpenAiKey ||
                                    retryFromStepMutation.isPending ||
                                    retryMutation.isLoading
                                  }
                                >
                                  {retryFromStepMutation.isPending ? "Retrying..." : "Retry"}
                                </Button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Progreso imágenes */}
                  <Separator />
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-muted-foreground">
                        Frames processed
                      </span>
                      <span className="font-mono text-[11px]">
                        {job.processedImages ?? 0} /{" "}
                        {job.totalImages ?? 0}
                      </span>
                    </div>
                    <Progress value={progressPct} />
                    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                      <span>
                        Batches:{" "}
                        <span className="font-mono">
                          {job.batchesCompleted ?? 0} / {job.totalBatches ?? 0}
                        </span>
                      </span>
                      <span>
                        Submitted:{" "}
                        <span className="font-mono">
                          {job.submittedImages ?? 0} / {job.totalImages ?? 0}
                        </span>
                      </span>
                    </div>
                  </div>

                  {/* Debug / detalles */}
                  <Separator />
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">
                      Details
                    </p>
                    <ScrollArea className="h-24 rounded-md border bg-muted/40 px-2 py-1 text-xs">
                      <div className="space-y-1">
                        <p>
                          <span className="font-semibold">Status:</span>{" "}
                          {job.status}
                        </p>
                        <p>
                          <span className="font-semibold">Step:</span>{" "}
                          {job.step}
                        </p>
                        <p>
                          <span className="font-semibold">Created:</span>{" "}
                          {job.createdAt
                            ? new Date(job.createdAt).toLocaleString()
                            : "-"}
                        </p>
                        <p>
                          <span className="font-semibold">Updated:</span>{" "}
                          {job.updatedAt
                            ? new Date(job.updatedAt).toLocaleString()
                            : "-"}
                        </p>
                        {job.error && (
                          <p className="text-destructive">
                            <span className="font-semibold">Error:</span>{" "}
                            {job.error}
                          </p>
                        )}
                      </div>
                    </ScrollArea>
                  </div>
                </>
              )}
            </CardContent>

            <CardFooter className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleRetry}
                  disabled={
                    !hasOpenAiKey ||
                    !currentJobId ||
                    retryMutation.isLoading ||
                    retryFromStepMutation.isPending ||
                    job?.status === JobsStatus.DONE ||
                    isProcessing
                  }
                >
                  {retryMutation.isLoading
                    ? "Retrying..."
                    : job?.status === JobsStatus.ERROR && job?.step
                    ? `Retry from ${stepLabel[job.step]}`
                    : "Retry job"}
                </Button>

                <Button
                  type="button"
                  size="sm"
                  onClick={handleDownloadTxt}
                  disabled={
                    !hasOpenAiKey ||
                    !currentJobId ||
                    !job ||
                    job.status !== "DONE" ||
                    !job.hasResults ||
                    resultQuery.isLoading ||
                    !resultQuery.ocrResult?.txt
                  }
                >
                  Download TXT
                </Button>

                <Button
                  type="button"
                  size="sm"
                  onClick={handleDownloadDocx}
                  disabled={
                    !hasOpenAiKey ||
                    !currentJobId ||
                    !job ||
                    job.status !== "DONE" ||
                    !job.hasResults ||
                    resultQuery.isLoading ||
                    !resultQuery.ocrResult?.docx
                  }
                >
                  Download DOCX
                </Button>

                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={handleDownloadRawZip}
                  disabled={
                    !hasOpenAiKey ||
                    !currentJobId ||
                    !job ||
                    job.status !== "DONE" ||
                    !job.hasResults ||
                    resultQuery.isLoading ||
                    !resultQuery.ocrResult?.rawZip
                  }
                >
                  Download Filtered ZIP
                </Button>
              </div>

              {job?.status === JobsStatus.DONE && (
                <p className="text-xs text-muted-foreground">
                  Job finished successfully. You can download the extracted
                  subtitles as TXT, DOCX, or the filtered RAW ZIP.
                </p>
              )}
              {job?.status === JobsStatus.ERROR && (
                <p className="text-xs text-destructive">
                  Job failed. Fix the issue, then click{" "}
                  <span className="font-semibold">Retry job</span> to resume
                  from the last step.
                </p>
              )}
            </CardFooter>
          </Card>
        </div>
      </div>
    </div>
  );
};

