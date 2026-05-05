/**
 * Thin wrapper around the EmailsVia public API.
 * The host URL can be overridden via Script Properties for testing
 * against a localhost dev tunnel (set EMAILSVIA_BASE_URL).
 */
const EmailsVia = (function () {
  function baseUrl() {
    return (
      PropertiesService.getScriptProperties().getProperty('EMAILSVIA_BASE_URL') ||
      'https://emailsvia.com'
    );
  }

  /**
   * @param {string} apiKey - eav_live_… personal access token
   * @param {object} payload - {name, subject, template, rows, ...optional}
   * @returns {{ok:true, campaign_id:string, recipient_count:number, duplicates_skipped:number}
   *           |{ok:false, error:string}}
   */
  function createCampaignFromSheet(apiKey, payload) {
    const url = baseUrl() + '/api/v1/campaigns/from-sheet';
    let response;
    try {
      response = UrlFetchApp.fetch(url, {
        method: 'post',
        contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + apiKey },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true,
      });
    } catch (e) {
      return { ok: false, error: 'Network error: ' + (e && e.message ? e.message : e) };
    }
    const code = response.getResponseCode();
    let body;
    try {
      body = JSON.parse(response.getContentText());
    } catch (_e) {
      body = {};
    }
    if (code >= 200 && code < 300 && body.ok) {
      return {
        ok: true,
        campaign_id: body.campaign_id,
        recipient_count: body.recipient_count || 0,
        duplicates_skipped: body.duplicates_skipped || 0,
      };
    }
    if (code === 401) return { ok: false, error: 'Invalid API key — re-paste it in the Connect step.' };
    if (code === 402) return { ok: false, error: body.message || 'Plan limit reached. Upgrade or split the sheet.' };
    if (body && body.error) return { ok: false, error: body.error + (body.message ? ': ' + body.message : '') };
    return { ok: false, error: 'EmailsVia returned HTTP ' + code };
  }

  return {
    createCampaignFromSheet: createCampaignFromSheet,
  };
})();
