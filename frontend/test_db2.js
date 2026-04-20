const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);
async function test() {
   const { data } = await supabase.from('invoices').select('trade_location').limit(10);
   console.log(data);
}
test();
