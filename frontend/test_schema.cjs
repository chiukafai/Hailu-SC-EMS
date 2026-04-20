const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);
async function check() {
  const { data: invData } = await supabase.from('invoices').select('*').limit(1);
  const { data: taxData } = await supabase.from('tax_invoices').select('*').limit(1);
  const res = {
    trade_keys: invData && invData.length > 0 ? Object.keys(invData[0]) : "Empty",
    tax_keys: taxData && taxData.length > 0 ? Object.keys(taxData[0]) : "Empty"
  };
  fs.writeFileSync('./schema_output.json', JSON.stringify(res, null, 2));
}
check();
