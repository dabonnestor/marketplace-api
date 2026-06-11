export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export async function paginate<T extends Record<string, unknown>>(
  dataQuery: Promise<T[]> & { limit(n: number): any; offset(n: number): any },
  countQuery: any,
  page: number,
  limit: number,
): Promise<PaginatedResult<T>> {
  const offset = (page - 1) * limit;

  const [results, [{ count }]] = await Promise.all([
    dataQuery.limit(limit).offset(offset),
    countQuery,
  ]);

  return {
    data: results as T[],
    pagination: {
      page,
      limit,
      total: count as number,
      totalPages: Math.ceil((count as number) / limit),
    },
  };
}
