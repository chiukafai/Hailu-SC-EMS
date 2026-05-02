import { createClient } from '@supabase/supabase-js';

// 这是连接海露供应链后端存储的唯一入口
const supabaseUrl = 'https://mdukduvdzwxfheyqvkfy.supabase.co';
const supabaseAnon_Key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1kdWtkdXZkend4ZmhleXF2a2Z5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4NjcxNzUsImV4cCI6MjA4ODQ0MzE3NX0.aZwlzWuEZWoG2rfJoyWqDz5l0dfb4Tj-TKRNr5K1y54';

export const supabase = createClient(supabaseUrl, supabaseAnon_Key);