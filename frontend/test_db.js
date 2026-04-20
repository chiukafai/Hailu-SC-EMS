const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);
async function check() {
  const { data, error } = await supabase.from('tax_invoices').select('*').limit(1);
  console.log("Data keys:", data && data.length > 0 ? Object.keys(data[0]) : (error || "Empty"));
}
check();
