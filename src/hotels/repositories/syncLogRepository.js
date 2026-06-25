const supabase = require('../../db/supabase');

async function createSyncLog({ supplier, syncType, requestUrl, requestPayload }) {
  const { data, error } = await supabase
    .from('hotels_sync_logs')
    .insert({
      supplier,
      sync_type: syncType,
      request_url: requestUrl,
      request_payload: requestPayload,
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error) throw error;
  return data.id;
}

async function completeSyncLog({ id, responseStatus, recordsProcessed, success, errorMessage }) {
  const { error } = await supabase
    .from('hotels_sync_logs')
    .update({
      response_status: responseStatus,
      records_processed: recordsProcessed,
      success,
      error_message: errorMessage ?? null,
      completed_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) throw error;
}

async function getSyncLog(id) {
  const { data, error } = await supabase
    .from('hotels_sync_logs')
    .select('id, success, error_message, completed_at, records_processed, started_at')
    .eq('id', id)
    .single();

  if (error) throw error;
  return data;
}

module.exports = { createSyncLog, completeSyncLog, getSyncLog };
