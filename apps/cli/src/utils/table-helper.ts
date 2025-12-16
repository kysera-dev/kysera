import { table as rawTable, type TableOptions, type TableColumn } from '@xec-sh/kit';

/**
 * Helper to display a table from an array of objects
 * Automatically generates columns from the first object's keys
 */
export function displayTable<T extends Record<string, any>>(
  data: T[],
  options?: Partial<Omit<TableOptions<T>, 'data' | 'columns'>> & {
    columns?: TableColumn<T>[];
  }
): void {
  if (data.length === 0) {
    return;
  }

  // Auto-generate columns from first object if not provided
  const columns = options?.columns || Object.keys(data[0]).map((key) => ({
    key: key as keyof T,
    header: key.charAt(0).toUpperCase() + key.slice(1), // Capitalize first letter
  }));

  rawTable<T>({
    data,
    columns,
    ...options,
  });
}
