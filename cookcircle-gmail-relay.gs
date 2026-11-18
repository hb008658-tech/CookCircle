/**
 * CookCircle verification email relay.
 * Deploy this as a Google Apps Script web app that executes as its owner.
 * Keep the relay token in Script Properties and in Render's environment only.
 */

function createCookCircleRelayToken() {
  // Trigger Google's one-time send-mail authorization while the owner is signed in.
  MailApp.getRemainingDailyQuota();
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('COOKCIRCLE_GMAIL_RELAY_TOKEN', token);
  console.log('Copy this token into Render as COOKCIRCLE_GMAIL_RELAY_TOKEN. Do not share it: ' + token);
}

function doPost(e) {
  try {
    const raw = e && e.postData && e.postData.contents;
    if (!raw || raw.length > 8192) return json_({ ok: false, error: 'invalid_request' });

    const input = JSON.parse(raw);
    const expected = PropertiesService.getScriptProperties().getProperty('COOKCIRCLE_GMAIL_RELAY_TOKEN') || '';
    if (!expected || !sameSecret_(String(input.token || ''), expected)) {
      return json_({ ok: false, error: 'unauthorized' });
    }

    const recipient = String(input.to || '').trim().toLowerCase();
    const code = String(input.code || '').trim();
    if (recipient.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient) || !/^\d{6}$/.test(code)) {
      return json_({ ok: false, error: 'invalid_request' });
    }

    const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, recipient)
      .map(function (byte) { return ('0' + (byte & 255).toString(16)).slice(-2); }).join('');
    const cache = CacheService.getScriptCache();
    const cooldownKey = 'sent_' + digest;
    if (cache.get(cooldownKey)) return json_({ ok: false, error: 'cooldown' });
    if (MailApp.getRemainingDailyQuota() < 1) return json_({ ok: false, error: 'daily_limit' });

    MailApp.sendEmail(
      recipient,
      'Your CookCircle verification code',
      'Your CookCircle verification code is ' + code + '.\n\nThis code expires in 10 minutes. If you did not request it, ignore this email.',
      { name: 'CookCircle' }
    );
    cache.put(cooldownKey, '1', 45);
    return json_({ ok: true });
  } catch (error) {
    // Avoid logging email addresses, verification codes, or the relay token.
    console.error('CookCircle relay failed while processing an email.');
    return json_({ ok: false, error: 'delivery_failed' });
  }
}

function sameSecret_(actual, expected) {
  if (!actual || actual.length !== expected.length) return false;
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return difference === 0;
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
