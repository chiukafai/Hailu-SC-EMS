import { supabase } from './supabaseClient';

// ========== 字典数据类型 ==========
export interface Organization {
  id: string;
  name: string;
  tax_id?: string;
  path?: string;
}

export interface GlobalClient {
  id: string;
  name: string;
  tax_id: string;
}

export interface Department {
  id: string;
  name: string;
}

// ========== 内存缓存 ==========
let orgCache: Organization[] | null = null;
let clientCache: GlobalClient[] | null = null;
let deptCache: Department[] | null = null;

const CACHE_TTL = 5 * 60 * 1000; // 5分钟
let cacheTimestamp = 0;

function isCacheValid(): boolean {
  return Date.now() - cacheTimestamp < CACHE_TTL && !!orgCache && !!clientCache && !!deptCache;
}

// ========== 字典服务 ==========
export const dictionaryService = {
  /**
   * 获取所有组织（带缓存）
   */
  async getOrganizations(): Promise<Organization[]> {
    if (isCacheValid() && orgCache) return orgCache;

    const { data, error } = await supabase
      .from('organizations')
      .select('id, name, tax_id, path')
      .order('name');

    if (error) {
      console.error('[dictionaryService] Failed to fetch organizations:', error.message);
      return orgCache ?? [];
    }

    orgCache = data as Organization[];
    updateCacheTime();
    return orgCache!;
  },

  /**
   * 获取所有客户（带缓存）
   */
  async getClients(): Promise<GlobalClient[]> {
    if (isCacheValid() && clientCache) return clientCache;

    const { data, error } = await supabase
      .from('global_clients')
      .select('id, name, tax_id')
      .order('name');

    if (error) {
      console.error('[dictionaryService] Failed to fetch clients:', error.message);
      return clientCache ?? [];
    }

    clientCache = data as GlobalClient[];
    updateCacheTime();
    return clientCache!;
  },

  /**
   * 获取所有部门（带缓存）
   */
  async getDepartments(): Promise<Department[]> {
    if (isCacheValid() && deptCache) return deptCache;

    const { data, error } = await supabase
      .from('departments')
      .select('id, name')
      .order('name');

    if (error) {
      console.error('[dictionaryService] Failed to fetch departments:', error.message);
      return deptCache ?? [];
    }

    deptCache = data as Department[];
    updateCacheTime();
    return deptCache!;
  },

  /**
   * 一次性获取所有字典数据
   */
  async getAll(): Promise<{
    organizations: Organization[];
    clients: GlobalClient[];
    departments: Department[];
  }> {
    if (isCacheValid()) {
      return { organizations: orgCache!, clients: clientCache!, departments: deptCache! };
    }

    const [orgs, clients, depts] = await Promise.all([
      this.getOrganizations(),
      this.getClients(),
      this.getDepartments(),
    ]);

    return { organizations: orgs, clients, departments: depts };
  },

  /**
   * 手动清除缓存（增删改操作后调用）
   */
  clearCache(): void {
    orgCache = null;
    clientCache = null;
    deptCache = null;
    cacheTimestamp = 0;
  },
};

function updateCacheTime(): void {
  cacheTimestamp = Date.now();
}
