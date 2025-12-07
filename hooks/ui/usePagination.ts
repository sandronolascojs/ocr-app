"use client";

import { useQueryStates } from "nuqs";
import { useMemo } from "react";
import { paginationParsers } from "@/lib/pagination/searchParams";
import type { PaginationResult, PaginationConfig } from "@/types/pagination";

interface UsePaginationOptions extends PaginationConfig {
  key?: string;
}

export const usePagination = (
  options?: UsePaginationOptions
): PaginationResult => {
  const {
    key = "page",
    minPageSize = 1,
    maxPageSize = 100,
  } = options ?? {};

  const [{ pageIndex, pageSize }, setPagination] = useQueryStates(
    paginationParsers
  );

  const validatedPageSize = useMemo(() => {
    if (pageSize < minPageSize) return minPageSize;
    if (pageSize > maxPageSize) return maxPageSize;
    return pageSize;
  }, [pageSize, minPageSize, maxPageSize]);

  const offset = useMemo(
    () => pageIndex * validatedPageSize,
    [pageIndex, validatedPageSize]
  );

  const limit = validatedPageSize;

  const handleSetPageIndex = (newPageIndex: number) => {
    if (newPageIndex < 0) return;
    setPagination({ pageIndex: newPageIndex });
  };

  const handleSetPageSize = (newPageSize: number) => {
    const validated = Math.max(
      minPageSize,
      Math.min(maxPageSize, newPageSize)
    );
    setPagination({
      pageSize: validated,
      pageIndex: 0,
    });
  };

  const handleNextPage = () => {
    handleSetPageIndex(pageIndex + 1);
  };

  const handlePreviousPage = () => {
    if (pageIndex > 0) {
      handleSetPageIndex(pageIndex - 1);
    }
  };

  const handleGoToPage = (newPageIndex: number) => {
    handleSetPageIndex(newPageIndex);
  };

  return {
    pageIndex,
    pageSize: validatedPageSize,
    offset,
    limit,
    setPageIndex: handleSetPageIndex,
    setPageSize: handleSetPageSize,
    nextPage: handleNextPage,
    previousPage: handlePreviousPage,
    goToPage: handleGoToPage,
  };
};

