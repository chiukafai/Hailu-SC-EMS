import { supabase } from '../api/supabase';

export type AuditActionType = 'LOGIN' | 'CREATE' | 'UPDATE' | 'DELETE' | 'EXPORT' | 'IMPORT' | 'SYSTEM';

export const logAudit = async (
    userId: string | null,
    actionType: AuditActionType,
    module: string,
    description: string,
    details?: any
) => {
    try {
        await supabase.from('audit_logs').insert([{
            user_id: userId,
            action_type: actionType,
            module: module,
            description: description,
            details: details || {}
        }]);
    } catch (error) {
        console.error("Audit Logging Failed", error);
    }
};
