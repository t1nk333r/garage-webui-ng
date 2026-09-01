import api, { encodeObjectPath } from "@/lib/api";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  UseMutationOptions,
} from "@tanstack/react-query";
import {
  BulkDeleteResult,
  GetObjectsResult,
  PutObjectPayload,
  SearchObjectsResult,
  UseBrowserObjectOptions,
} from "./types";

export const getNextObjectPageParam = (lastPage: GetObjectsResult) =>
  lastPage.nextToken ?? undefined;

export const useBrowseObjects = (
  bucket: string,
  options?: UseBrowserObjectOptions
) => {
  return useInfiniteQuery({
    queryKey: ["browse", bucket, options],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api.get<GetObjectsResult>(`/browse/${bucket}`, {
        params: { ...options, ...(pageParam ? { next: pageParam } : {}) },
      }),
    getNextPageParam: getNextObjectPageParam,
  });
};

export const useSearchObjects = (bucket: string, q: string, prefix: string) =>
  useQuery({
    queryKey: ["search", bucket, prefix, q],
    queryFn: () =>
      api.get<SearchObjectsResult>(`/search/${bucket}`, {
        params: { q, prefix },
      }),
    enabled: q.trim().length >= 2,
    staleTime: 30_000,
  });

export const usePutObject = (
  bucket: string,
  options?: UseMutationOptions<any, Error, PutObjectPayload>
) => {
  return useMutation({
    mutationFn: async (body) => {
      const formData = new FormData();
      if (body.file) {
        formData.append("file", body.file);
      }

      return api.put(`/browse/${bucket}/${encodeObjectPath(body.key)}`, {
        body: formData,
      });
    },
    ...options,
  });
};

export const useDeleteObject = (
  bucket: string,
  options?: UseMutationOptions<any, Error, { key: string; recursive?: boolean }>
) => {
  return useMutation({
    mutationFn: (data) =>
      // `bucket` is not encoded here: Garage bucket aliases are
      // DNS-compatible names and never need percent-encoding.
      api.delete(`/browse/${bucket}/${encodeObjectPath(data.key)}`, {
        params: { recursive: data.recursive },
      }),
    ...options,
  });
};

export const useBulkDelete = (
  bucket: string,
  options?: UseMutationOptions<BulkDeleteResult, Error, string[]>
) => {
  return useMutation({
    mutationFn: (keys) =>
      api.post<BulkDeleteResult>(`/browse/${bucket}`, {
        body: { action: "delete", keys },
      }),
    ...options,
  });
};

export const useDownloadToken = (
  bucket: string,
  options?: UseMutationOptions<{ token: string }, Error, string[]>
) => {
  return useMutation({
    mutationFn: (keys) =>
      api.post<{ token: string }>("/browse/download-token", {
        body: { bucket, keys },
      }),
    ...options,
  });
};

export const useShareLink = (bucket: string) => {
  return useMutation({
    mutationFn: (v: { key: string; expires: number }) =>
      api.get<{ url: string; expiresSeconds: number }>(
        `/share/${bucket}/${encodeObjectPath(v.key)}`,
        { params: { expires: v.expires } }
      ),
  });
};
