const crypto = require('crypto');

function b64url(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function getCredentialsFromN8n() {
  try {
    return $('Set Credentials').first().json || {};
  } catch {
    return $input.first().json || {};
  }
}

function normalizePrivateKey(raw) {
  let value = String(raw || '').trim();

  if (!value) {
    return '';
  }

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  value = value
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\r\n/g, '\n')
    .trim();

  if (!value.includes('BEGIN')) {
    value = [
      '-----BEGIN PRIVATE KEY-----',
      value.replace(/\s+/g, ''),
      '-----END PRIVATE KEY-----',
    ].join('\n');
  }

  return value;
}

function createPrivateKeyOrThrow(privateKeyPem) {
  try {
    return crypto.createPrivateKey({
      key: privateKeyPem,
      format: 'pem',
    });
  } catch (error) {
    const firstLine = privateKeyPem.split('\n')[0] || '<empty>';
    throw new Error(
      `Invalid GOOGLE_PRIVATE_KEY format. First line: ${firstLine}. Original error: ${error.message}`
    );
  }
}

const input = $input.first().json || {};
const credentials = { ...getCredentialsFromN8n(), ...input };

const serviceAccountEmail = String(credentials['✅GOOGLE_SERVICE_ACCOUNT_EMAIL'] || '').trim();
const privateKeyPem = normalizePrivateKey(credentials['✅GOOGLE_PRIVATE_KEY']);
const scope = String(
  credentials['✅GOOGLE_SCOPE'] || 'https://www.googleapis.com/auth/spreadsheets.readonly'
).trim();

if (!serviceAccountEmail || !privateKeyPem) {
  throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_PRIVATE_KEY');
}

const privateKey = createPrivateKeyOrThrow(privateKeyPem);
const now = Math.floor(Date.now() / 1000);

const encodedHeader = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
const encodedPayload = b64url(
  JSON.stringify({
    iss: serviceAccountEmail,
    scope,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })
);

const signingInput = `${encodedHeader}.${encodedPayload}`;
const signature = crypto
  .sign('RSA-SHA256', Buffer.from(signingInput, 'utf8'), privateKey)
  .toString('base64')
  .replace(/=/g, '')
  .replace(/\+/g, '-')
  .replace(/\//g, '_');

return [
  {
    json: {
      ...input,
      assertion: `${signingInput}.${signature}`,
    },
  },
];
