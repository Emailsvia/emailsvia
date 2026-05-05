/**
 * EmailsVia — Sheets add-on entry points.
 * Apps Script invokes onHomepage() when the user opens the add-on sidebar.
 */

function onHomepage(e) {
  return buildHomeCard();
}

/** Saves the API key the user pasted into the form, then re-renders. */
function saveApiKey(e) {
  const key = (e.formInput.api_key || '').trim();
  if (!key) {
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText('Paste a key first.'))
      .build();
  }
  if (!/^eav_(live|test)_[a-z0-9]+$/i.test(key)) {
    return CardService.newActionResponseBuilder()
      .setNotification(
        CardService.newNotification().setText('That doesn\'t look like an EmailsVia key (eav_live_…).')
      )
      .build();
  }
  PropertiesService.getUserProperties().setProperty('EMAILSVIA_KEY', key);
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().updateCard(buildHomeCard()))
    .setNotification(CardService.newNotification().setText('Key saved.'))
    .build();
}

/** Removes the stored API key. */
function clearApiKey() {
  PropertiesService.getUserProperties().deleteProperty('EMAILSVIA_KEY');
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().updateCard(buildHomeCard()))
    .setNotification(CardService.newNotification().setText('Key cleared.'))
    .build();
}

/**
 * Reads the active sheet, builds the campaign payload, and POSTs it to
 * EmailsVia. On success, opens the new campaign in a new tab.
 */
function sendMerge(e) {
  const key = PropertiesService.getUserProperties().getProperty('EMAILSVIA_KEY');
  if (!key) {
    return notify('Connect an API key first.');
  }

  const name = (e.formInput.campaign_name || '').trim();
  const subject = (e.formInput.subject || '').trim();
  const template = (e.formInput.template || '').trim();
  if (!name || !subject || !template) {
    return notify('Name, subject, and message are required.');
  }

  const rows = readActiveSheetRows();
  if (rows.error) return notify(rows.error);
  if (rows.rows.length === 0) return notify('No rows with an email column found.');

  try {
    const result = EmailsVia.createCampaignFromSheet(key, {
      name: name,
      subject: subject,
      template: template,
      rows: rows.rows,
    });
    if (!result.ok) return notify(result.error);

    const url = 'https://emailsvia.com/app/campaigns/' + result.campaign_id;
    return CardService.newActionResponseBuilder()
      .setOpenLink(CardService.newOpenLink().setUrl(url))
      .setNotification(
        CardService.newNotification().setText(
          'Created · ' +
            result.recipient_count +
            ' recipients' +
            (result.duplicates_skipped ? ' (' + result.duplicates_skipped + ' duplicates skipped)' : '')
        )
      )
      .build();
  } catch (err) {
    return notify('Failed: ' + (err && err.message ? err.message : err));
  }
}

/**
 * Pulls every row from the active sheet, treats the first row as headers,
 * and emits {email, name, company, ...rest} objects. The "email" column
 * is required and is matched case-insensitively. Other columns become
 * merge tags accessible as {{ColumnName}} in the template.
 */
function readActiveSheetRows() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();
  const range = sheet.getDataRange();
  const values = range.getValues();
  if (values.length < 2) return { error: 'Sheet has no data rows.', rows: [] };

  const headers = values[0].map(function (h) { return String(h || '').trim(); });
  const emailIdx = headers.findIndex(function (h) { return h.toLowerCase() === 'email'; });
  if (emailIdx === -1) return { error: 'No "email" column found in the header row.', rows: [] };

  const nameIdx = headers.findIndex(function (h) { return h.toLowerCase() === 'name'; });
  const companyIdx = headers.findIndex(function (h) { return h.toLowerCase() === 'company'; });

  const out = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const email = String(row[emailIdx] || '').trim();
    if (!email) continue;
    const obj = { email: email };
    if (nameIdx !== -1) obj.name = String(row[nameIdx] || '').trim();
    if (companyIdx !== -1) obj.company = String(row[companyIdx] || '').trim();
    for (let c = 0; c < headers.length; c++) {
      if (c === emailIdx || c === nameIdx || c === companyIdx) continue;
      const header = headers[c];
      if (!header) continue;
      const v = row[c];
      if (v === null || v === undefined || v === '') continue;
      obj[header] = String(v);
    }
    out.push(obj);
  }
  return { rows: out };
}

function notify(msg) {
  return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification().setText(msg))
    .build();
}
