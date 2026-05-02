export type UserRole = 'admin' | 'user';
export type PermissionLevel = 'edit' | 'view' | 'none';

export interface UserPermissions {
  dash?: PermissionLevel;
  org?: PermissionLevel;
  dept?: PermissionLevel;
  client?: PermissionLevel;
  invoices?: PermissionLevel;
  financial?: PermissionLevel;
  [key: string]: PermissionLevel | undefined;
}

export interface AppUser {
  id: string;
  username: string;
  password?: string;
  role: UserRole;
  permissions: UserPermissions;
  department_id?: string;
  is_department_head?: boolean;
  created_at?: string;
  updated_at?: string;
  // joined fields
  departments?: { name: string };
}

export interface StaffMember {
  name: string;
  post: string;
  phone: string;
}

export interface Department {
  id: string;
  name: string;
  head?: string;
  head_post?: string;
  head_phone?: string;
  staff_members?: StaffMember[];
  created_at?: string;
  updated_at?: string;
}
