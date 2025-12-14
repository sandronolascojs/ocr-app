"use client";

import * as React from "react";
import { useMemo } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { JobsStatus, JobStep, JobType } from "@/types";
import { Badge } from "@/components/ui/badge";

interface JobProgressCardProps {
  jobId: string | null;
  job: {
    jobId: string;
    jobType: JobType;
    status: JobsStatus;
    step: JobStep | null;
    error: string | null;
    totalImages: number | null;
    processedImages: number | null;
    totalBatches: number | null;
    batchesCompleted: number | null;
    submittedImages: number | null;
    hasResults?: boolean;
    createdAt: Date | null;
    updatedAt: Date | null;
  } | null;
  isLoading?: boolean;
  progressPct: number;
  // Actions
  onRetry?: () => void;
  onRetryFromStep?: (step: JobStep) => void;
  onDownloadTxt?: () => void;
  onDownloadDocx?: () => void;
  onDownloadRawZip?: () => void;
  onDownloadCroppedZip?: () => void;
  onRemoveSubtitles?: () => void;
  // Action states
  canRetry?: boolean;
  canDownloadTxt?: boolean;
  canDownloadDocx?: boolean;
  canDownloadRawZip?: boolean;
  canDownloadCroppedZip?: boolean;
  canRemoveSubtitles?: boolean;
  isRetrying?: boolean;
  isRetryingFromStep?: boolean;
  isRemovingSubtitles?: boolean;
  // Results
  hasTxtResult?: boolean;
  hasDocxResult?: boolean;
  hasRawZipResult?: boolean;
  hasCroppedZipResult?: boolean;
}

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

const statusVariant: Record<JobsStatus, React.ComponentProps<typeof Badge>["variant"]> = {
  [JobsStatus.PENDING]: "secondary",
  [JobsStatus.PROCESSING]: "default",
  [JobsStatus.DONE]: "default",
  [JobsStatus.ERROR]: "destructive",
};

export const JobProgressCard = ({
  jobId,
  job,
  isLoading = false,
  progressPct,
  onRetry,
  onRetryFromStep,
  onDownloadTxt,
  onDownloadDocx,
  onDownloadRawZip,
  onDownloadCroppedZip,
  onRemoveSubtitles,
  canRetry = false,
  canDownloadTxt = false,
  canDownloadDocx = false,
  canDownloadRawZip = false,
  canDownloadCroppedZip = false,
  canRemoveSubtitles = false,
  isRetrying = false,
  isRetryingFromStep = false,
  isRemovingSubtitles = false,
  hasCroppedZipResult = false,
}: JobProgressCardProps) => {
  // Get steps based on job type
  const steps = useMemo(() => {
    if (!job) return [];
    if (job.jobType === JobType.SUBTITLE_REMOVAL) {
      // SUBTITLE_REMOVAL only has PREPROCESSING and DONE
      return [JobStep.PREPROCESSING];
    }
    // OCR jobs have all steps
    return [
      JobStep.PREPROCESSING,
      JobStep.BATCH_SUBMITTED,
      JobStep.RESULTS_SAVED,
      JobStep.DOCS_BUILT,
    ];
  }, [job?.jobType]);

  // Calculate progress values
  const totalImagesEffective = useMemo(() => {
    if (!job) return 0;
    if (job.totalImages && job.totalImages > 0) return job.totalImages;
    if (job.submittedImages && job.submittedImages > 0) return job.submittedImages;
    return 0;
  }, [job]);

  const processedImages = job?.processedImages ?? 0;
  const imagesProgressPct = useMemo(() => {
    if (!totalImagesEffective) return 0;
    return Math.round((processedImages / totalImagesEffective) * 100);
  }, [processedImages, totalImagesEffective]);

  const batchesProgressPct = useMemo(() => {
    if (!job?.totalBatches || job.totalBatches === 0) return 0;
    return Math.round(((job.batchesCompleted ?? 0) / job.totalBatches) * 100);
  }, [job]);

  const submittedProgressPct = useMemo(() => {
    if (!totalImagesEffective) return 0;
    return Math.round(((job?.submittedImages ?? 0) / totalImagesEffective) * 100);
  }, [job, totalImagesEffective]);

  const isProcessing = job?.status === JobsStatus.PENDING || job?.status === JobsStatus.PROCESSING;

  return (
    <Card className="flex flex-col">
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div className="space-y-1">
          <CardTitle>Job status</CardTitle>
          <CardDescription className="break-all">
            {jobId ? (
              <>
                Job ID:{" "}
                <span className="font-mono text-xs">{jobId}</span>
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
        {isLoading && !job && jobId && (
          <p className="text-sm text-muted-foreground">
            Loading job info...
          </p>
        )}

        {!jobId && (
          <p className="text-sm text-muted-foreground">
            No job selected. Upload a ZIP to start a new job or go to History to load an existing job.
          </p>
        )}

        {job && (
          <>
            {/* Steps timeline */}
            {steps.length > 0 && (
              <div className="space-y-3">
                <p className="text-xs font-medium uppercase text-muted-foreground">
                  Pipeline steps
                </p>
                <div className="space-y-2">
                  {steps.map((s) => {
                    const isActive = job.step === s;
                    // For SUBTITLE_REMOVAL jobs, only PREPROCESSING is valid
                    // If step is invalid (e.g., DOCS_BUILT), treat it as if still in PREPROCESSING
                    const effectiveStep = job.jobType === JobType.SUBTITLE_REMOVAL && 
                      job.step !== JobStep.PREPROCESSING && 
                      job.status !== JobsStatus.DONE
                        ? JobStep.PREPROCESSING // Treat invalid steps as PREPROCESSING
                        : job.step;
                    const isCompleted =
                      (effectiveStep === JobStep.BATCH_SUBMITTED && s === JobStep.PREPROCESSING) ||
                      (effectiveStep === JobStep.RESULTS_SAVED &&
                        (s === JobStep.PREPROCESSING ||
                          s === JobStep.BATCH_SUBMITTED)) ||
                      (effectiveStep === JobStep.DOCS_BUILT &&
                        (s === JobStep.PREPROCESSING ||
                          s === JobStep.BATCH_SUBMITTED ||
                          s === JobStep.RESULTS_SAVED)) ||
                      job.status === JobsStatus.DONE;
                    const isFailed = job.status === JobsStatus.ERROR;
                    const canRetryFromStep = isFailed && !isCompleted && onRetryFromStep;
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
                              onClick={() => onRetryFromStep(s)}
                              disabled={isRetryingFromStep || isRetrying}
                            >
                              {isRetryingFromStep ? "Retrying..." : "Retry"}
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Dynamic progress based on step */}
            <Separator />
            {job.step === JobStep.PREPROCESSING && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-muted-foreground">
                    Images processed
                  </span>
                  <span className="font-mono text-[11px]">
                    {processedImages} / {totalImagesEffective}
                  </span>
                </div>
                <Progress value={imagesProgressPct} />
              </div>
            )}
            {job.jobType === JobType.OCR && job.step !== null && job.step !== JobStep.PREPROCESSING && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-muted-foreground">
                    Batches
                  </span>
                  <span className="font-mono text-[11px]">
                    {job.batchesCompleted ?? 0} / {job.totalBatches ?? 0}
                  </span>
                </div>
                <Progress value={batchesProgressPct} />
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-muted-foreground">
                    Submitted
                  </span>
                  <span className="font-mono text-[11px]">
                    {job.submittedImages ?? 0} / {job.totalImages ?? 0}
                  </span>
                </div>
                <Progress value={submittedProgressPct} />
              </div>
            )}

            {/* Overall progress */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-muted-foreground">
                  Overall Progress
                </span>
                <span className="font-mono text-[11px]">
                  {progressPct}%
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
                    {job.step ?? "-"}
                  </p>
                  <p>
                    <span className="font-semibold">Type:</span>{" "}
                    {job.jobType}
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
          {onRetry && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onRetry}
              disabled={!canRetry || isRetrying || isRetryingFromStep || isProcessing}
            >
              {isRetrying
                ? "Retrying..."
                : job?.status === JobsStatus.ERROR && job?.step
                ? `Retry from ${stepLabel[job.step]}`
                : "Retry job"}
            </Button>
          )}

          {onDownloadTxt && (
            <Button
              type="button"
              size="sm"
              onClick={onDownloadTxt}
              disabled={!canDownloadTxt}
            >
              Download TXT
            </Button>
          )}

          {onDownloadDocx && (
            <Button
              type="button"
              size="sm"
              onClick={onDownloadDocx}
              disabled={!canDownloadDocx}
            >
              Download DOCX
            </Button>
          )}

          {onDownloadRawZip && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={onDownloadRawZip}
              disabled={!canDownloadRawZip}
            >
              Download Filtered ZIP
            </Button>
          )}

          {onDownloadCroppedZip && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={onDownloadCroppedZip}
              disabled={!canDownloadCroppedZip}
            >
              Download Cropped ZIP
            </Button>
          )}

          {onRemoveSubtitles && 
           job?.jobType === JobType.OCR && 
           job?.status === JobsStatus.DONE && 
           job?.hasResults && 
           !hasCroppedZipResult && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onRemoveSubtitles}
              disabled={!canRemoveSubtitles || isRemovingSubtitles}
            >
              {isRemovingSubtitles
                ? "Processing..."
                : "Generate Cropped ZIP"}
            </Button>
          )}
        </div>

        {job?.status === JobsStatus.DONE && (
          <p className="text-xs text-muted-foreground">
            {job.jobType === JobType.OCR
              ? "Job finished successfully. You can download the extracted subtitles as TXT, DOCX, the filtered RAW ZIP, or the cropped ZIP (without subtitles)."
              : "Job finished successfully. You can download the cropped ZIP (without subtitles)."}
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
  );
};

