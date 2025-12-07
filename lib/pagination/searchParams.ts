import { parseAsInteger, createSearchParamsCache } from "nuqs/server";
import { QUERY_CONFIG } from "@/constants/query.constants";

export const paginationParsers = {
  pageIndex: parseAsInteger.withDefault(0),
  pageSize: parseAsInteger.withDefault(QUERY_CONFIG.DEFAULT_PAGINATION.limit),
};

export const paginationSearchParamsCache = createSearchParamsCache(
  paginationParsers
);

