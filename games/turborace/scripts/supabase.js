import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.39.5/+esm';

const SUPABASE_URL='https://lglcvsptwkqxykapepey.supabase.co';
const SUPABASE_ANON_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnbGN2c3B0d2txeHlrYXBlcGV5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDcwNzQ1NDcsImV4cCI6MjA2MjY1MDU0N30.ci7v2g-5wixuPKnG6wUUO87AsbI1bQ8wzRnHHG9QzIQ';
export const supabase=createClient(SUPABASE_URL,SUPABASE_ANON_KEY);