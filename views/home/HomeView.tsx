// app/page.tsx
"use client";

import * as React from "react";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod/v3";
import { zodResolver } from "@hookform/resolvers/zod";

import { useUploadOcrZip } from "@/hooks/http/useUploadZip";
import { useOcrJob } from "@/hooks/http/useOcrJob";
import { useRetryOcrJob } from "@/hooks/http/useRetryOcrJob";
import { useOcrResult } from "@/hooks/http/useOcrResult";
import { useOcrJobs } from "@/hooks/http/useOcrJobs";

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
import { toast } from "sonner";
import { JobsStatus, JobStep } from "@/types";
import { cn } from "@/lib/utils";

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

// ---------- Helpers para descargar base64 ----------

function b64ToBlob(base64: string, mime: string) {
  const byteChars = atob(base64);
  const byteNumbers = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) {
    byteNumbers[i] = byteChars.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: mime });
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------- Página principal ----------

const HomePage = () => {
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [manualJobId, setManualJobId] = useState("");

  // Form de upload
  const form = useForm<UploadFormValues>({
    resolver: zodResolver(uploadSchema),
    defaultValues: {
      file: undefined,
    },
  });

  const {
    handleSubmit,
    setValue,
    formState: { errors },
    watch,
  } = form;

  const selectedFile: File | undefined = watch("file");

  // Mutations / queries
  const uploadMutation = useUploadOcrZip();
  const retryMutation = useRetryOcrJob();

  const jobQuery = useOcrJob(currentJobId);
  const jobsQuery = useOcrJobs({ limit: 25 });

  const job = jobQuery.data;
  const jobs = jobsQuery.jobs;

  const resultQuery = useOcrResult(
    currentJobId,
    job?.status === JobsStatus.DONE && !!job?.hasResults
  );

  const isProcessing =
    job?.status === JobsStatus.PENDING || job?.status === JobsStatus.PROCESSING;

  // Handlers

  const onSubmit = handleSubmit(async (values: UploadFormValues) => {
    try {
      const file = values.file as File;
      const { jobId } = await uploadMutation.mutateAsync({ file });
      setCurrentJobId(jobId);
      setManualJobId(jobId);
      toast.success("Job created", {
        description: `Job ID: ${jobId}`,
      });
    } catch (err: any) {
      console.error(err);
      toast.error("Error uploading ZIP", {
        description: err?.message ?? "Unexpected error",
      });
    }
  });

  const handleRetry = async () => {
    if (!currentJobId) return;
    try {
      await retryMutation.retryOcrJob({ jobId: currentJobId });
      toast.success("Job retried", {
        description: "The job will resume from its last step.",
      });
      jobQuery.refetch();
    } catch (err: any) {
      console.error(err);
      toast.error("Error retrying job", {
        description: err?.message ?? "Unexpected error",
      });
    }
  };

  const handleLoadJob = () => {
    if (!manualJobId.trim()) return;
    setCurrentJobId(manualJobId.trim());
  };

  const handleSelectJob = (jobId: string) => {
    setCurrentJobId(jobId);
    setManualJobId(jobId);
  };

  const handleDownloadTxt = () => {
    if (!resultQuery.ocrResult || !currentJobId) return;
    const blob = b64ToBlob(resultQuery.ocrResult.txtBase64, "text/plain");
    downloadBlob(blob, `${currentJobId}.txt`);
  };

  const handleDownloadDocx = () => {
    if (!resultQuery.ocrResult || !currentJobId) return;
    const blob = b64ToBlob(
      resultQuery.ocrResult.docxBase64,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    downloadBlob(blob, `${currentJobId}.docx`);
  };

  const handleDownloadRawZip = () => {
    if (!resultQuery.ocrResult?.rawZipBase64 || !currentJobId) return;
    const blob = b64ToBlob(resultQuery.ocrResult.rawZipBase64, "application/zip");
    downloadBlob(blob, `${currentJobId}-raw.zip`);
  };

  const progressPct = useMemo(() => {
    if (!job?.totalImages || job.totalImages === 0) return 0;
    return Math.round(((job.processedImages ?? 0) / job.totalImages) * 100);
  }, [job?.processedImages, job?.totalImages]);

  return (
    <main className="min-h-screen bg-background">
      <div className="container max-w-5xl py-10 space-y-8">
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

        <div className="grid gap-6 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.3fr)]">
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
                        setValue("file", undefined as any, {
                          shouldValidate: true,
                        });
                      }
                    }}
                  />
                  {selectedFile && (
                    <p className="text-xs text-muted-foreground">
                      Selected:{" "}
                      <span className="font-mono">{selectedFile.name}</span>{" "}
                      ({(selectedFile.size / 1024 / 1024).toFixed(2)} MB)
                    </p>
                  )}
                  {errors.file && (
                    <p className="text-xs text-destructive">
                      {errors.file.message as string}
                    </p>
                  )}
                </div>

                <Button
                  type="submit"
                  disabled={uploadMutation.isPending}
                  className="w-full"
                >
                  {uploadMutation.isPending ? "Uploading..." : "Start OCR Job"}
                </Button>
              </form>
            </CardContent>
            <CardFooter className="flex flex-col items-start gap-4">
              <Separator />
              <div className="w-full space-y-2">
                <Label htmlFor="jobIdInput">Load existing job</Label>
                <div className="flex gap-2">
                  <Input
                    id="jobIdInput"
                    placeholder="Paste job ID..."
                    value={manualJobId}
                    onChange={(e) => setManualJobId(e.target.value)}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleLoadJob}
                    disabled={!manualJobId.trim()}
                  >
                    Load
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Use this if you closed the page and want to resume monitoring
                  an existing job.
                </p>
              </div>
            </CardFooter>
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
                  No job selected. Upload a ZIP or load an existing Job ID.
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
                    !currentJobId ||
                    retryMutation.isLoading ||
                    job?.status === JobsStatus.DONE ||
                    isProcessing
                  }
                >
                  {retryMutation.isLoading ? "Retrying..." : "Retry job"}
                </Button>

                <Button
                  type="button"
                  size="sm"
                  onClick={handleDownloadTxt}
                  disabled={
                    !currentJobId ||
                    !job ||
                    job.status !== "DONE" ||
                    !job.hasResults ||
                    resultQuery.isLoading
                  }
                >
                  Download TXT
                </Button>

                <Button
                  type="button"
                  size="sm"
                  onClick={handleDownloadDocx}
                  disabled={
                    !currentJobId ||
                    !job ||
                    job.status !== "DONE" ||
                    !job.hasResults ||
                    resultQuery.isLoading
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
                    !currentJobId ||
                    !job ||
                    job.status !== "DONE" ||
                    !job.hasResults ||
                    resultQuery.isLoading ||
                    !resultQuery.ocrResult?.rawZipBase64
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

        <Card>
          <CardHeader className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div className="space-y-1">
              <CardTitle>Jobs overview</CardTitle>
              <CardDescription>
                Select any job to inspect its progress and resume tracking.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {jobsQuery.isRefetching && (
                <Badge variant="outline" className="text-[10px] uppercase">
                  refreshing
                </Badge>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => jobsQuery.refetch()}
                disabled={jobsQuery.isLoading}
              >
                Refresh
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {jobsQuery.isLoading && (
              <p className="text-sm text-muted-foreground">Loading recent jobs...</p>
            )}
            {jobsQuery.isError && (
              <p className="text-sm text-destructive">
                Failed to load jobs: {jobsQuery.error?.message ?? "Unknown error"}
              </p>
            )}
            {!jobsQuery.isLoading && !jobsQuery.isError && jobs.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No jobs yet. Upload a ZIP to start processing.
              </p>
            )}
            {!jobsQuery.isLoading && !jobsQuery.isError && jobs.length > 0 && (
              <ScrollArea className="max-h-[420px] pr-4">
                <div className="space-y-3 py-1">
                  {jobs.map((jobItem) => {
                    const isSelected = currentJobId === jobItem.jobId;
                    const jobProgress =
                      jobItem.totalImages && jobItem.totalImages > 0
                        ? Math.round(((jobItem.processedImages ?? 0) / jobItem.totalImages) * 100)
                        : 0;
                    return (
                      <button
                        key={jobItem.jobId}
                        type="button"
                        onClick={() => handleSelectJob(jobItem.jobId)}
                        className={cn(
                          "w-full rounded-lg border px-4 py-3 text-left transition hover:border-primary",
                          isSelected ? "border-primary/80 bg-primary/5" : "border-border bg-background"
                        )}
                      >
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <p className="font-mono text-xs">{jobItem.jobId}</p>
                            <p className="text-xs text-muted-foreground">
                              {stepLabel[jobItem.step]} ·{" "}
                              {jobItem.updatedAt
                                ? new Date(jobItem.updatedAt).toLocaleString()
                                : "Never updated"}
                            </p>
                          </div>
                          <Badge variant={statusVariant[jobItem.status]}>
                            {statusLabel[jobItem.status]}
                          </Badge>
                        </div>
                        <div className="mt-3 space-y-1">
                          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                            <span>Progress</span>
                            <span className="font-mono">
                              {jobItem.processedImages ?? 0} / {jobItem.totalImages ?? 0}
                            </span>
                          </div>
                          <Progress value={jobProgress} />
                        </div>
                        {jobItem.error && (
                          <p className="mt-2 text-xs text-destructive">
                            Error: {jobItem.error}
                          </p>
                        )}
                      </button>
                    );
                  })}
                </div>
              </ScrollArea>
            )}
          </CardContent>
          <CardFooter>
            <p className="text-xs text-muted-foreground">
              The list refreshes automatically every few seconds. Click any entry to load it above.
            </p>
          </CardFooter>
        </Card>
      </div>
    </main>
  );
};

export default HomePage;