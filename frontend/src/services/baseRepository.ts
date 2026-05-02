import { supabase } from './supabaseClient';

// ========== 通用分页结果类型 ==========
export interface PaginatedResult<T> {
  data: T[];
  total: number;
  error: Error | null;
}

// ========== 通用过滤选项 ==========
export interface FilterOptions {
  // 通用文本模糊匹配 (ilike)
  [key: string]: string | number | boolean | string[] | undefined;
}

// ========== 通用排序选项 ==========
export interface SortOptions {
  column: string;
  ascending?: boolean;
}

// ========== 基础 Repository ==========
export class BaseRepository<T> {
  constructor(protected table: string) {}

  /**
   * 分页查询（服务端分页）
   * @param page 页码（从1开始）
   * @param pageSize 每页条数
   * @param filters 可选过滤条件
   * @param sort 可选排序
   */
  async paginate(
    page: number,
    pageSize: number,
    filters?: FilterOptions,
    sort?: SortOptions
  ): Promise<PaginatedResult<T>> {
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = supabase
      .from(this.table)
      .select('*', { count: 'exact' });

    query = this.applyFilters(query, filters);

    if (sort) {
      query = query.order(sort.column, { ascending: sort.ascending ?? false });
    }

    const { data, count, error } = await query.range(from, to);

    return {
      data: (data ?? []) as T[],
      total: count ?? 0,
      error: error ? new Error(error.message) : null,
    };
  }

  /**
   * 全量查询（用于数据量可控的小表，如字典表、部门表等）
   */
  async findAll(sort?: SortOptions): Promise<PaginatedResult<T>> {
    let query = supabase.from(this.table).select('*');

    if (sort) {
      query = query.order(sort.column, { ascending: sort.ascending ?? false });
    }

    const { data, error } = await query;

    return {
      data: (data ?? []) as T[],
      total: data?.length ?? 0,
      error: error ? new Error(error.message) : null,
    };
  }

  /**
   * 根据 ID 查询单条记录
   */
  async findById(id: string): Promise<{ data: T | null; error: Error | null }> {
    const { data, error } = await supabase
      .from(this.table)
      .select('*')
      .eq('id', id)
      .single();

    return {
      data: data as T ?? null,
      error: error ? new Error(error.message) : null,
    };
  }

  /**
   * 新增单条记录
   */
  async create(record: Partial<T>): Promise<{ data: T | null; error: Error | null }> {
    const { data, error } = await supabase
      .from(this.table)
      .insert(record)
      .select()
      .single();

    return {
      data: data as T ?? null,
      error: error ? new Error(error.message) : null,
    };
  }

  /**
   * 更新记录
   */
  async update(id: string, record: Partial<T>): Promise<{ data: T | null; error: Error | null }> {
    const { data, error } = await supabase
      .from(this.table)
      .update(record)
      .eq('id', id)
      .select()
      .single();

    return {
      data: data as T ?? null,
      error: error ? new Error(error.message) : null,
    };
  }

  /**
   * 删除单条记录
   */
  async delete(id: string): Promise<{ error: Error | null }> {
    const { error } = await supabase.from(this.table).delete().eq('id', id);
    return { error: error ? new Error(error.message) : null };
  }

  /**
   * 批量删除（分块执行，避免超限）
   */
  async batchDelete(ids: string[], chunkSize = 100): Promise<{ error: Error | null }> {
    try {
      for (let i = 0; i < ids.length; i += chunkSize) {
        const chunk = ids.slice(i, i + chunkSize);
        const { error } = await supabase.from(this.table).delete().in('id', chunk);
        if (error) throw new Error(error.message);
      }
      return { error: null };
    } catch (e) {
      return { error: e instanceof Error ? e : new Error(String(e)) };
    }
  }

  /**
   * 应用过滤条件（子类可覆写实现自定义逻辑）
   */
  protected applyFilters(query: any, filters?: FilterOptions): any {
    if (!filters) return query;

    for (const [key, value] of Object.entries(filters)) {
      if (value === undefined || value === '' || value === null) continue;

      if (Array.isArray(value)) {
        // 数组 → IN 查询
        if (value.length > 0) {
          query = query.in(key, value);
        }
      } else if (typeof value === 'string') {
        // 字符串 → 模糊匹配
        query = query.ilike(key, `%${value}%`);
      } else if (typeof value === 'boolean') {
        // 布尔 → 精确匹配
        query = query.eq(key, value);
      } else {
        // 数字/其他 → 精确匹配
        query = query.eq(key, value);
      }
    }

    return query;
  }
}
