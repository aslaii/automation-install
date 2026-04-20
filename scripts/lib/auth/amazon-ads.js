const axios = require('axios');

async function mintAmazonAdsAccessToken(config, options = {}) {
  const axiosInstance = options.axiosInstance || axios;
  const timeout = Number.isFinite(options.timeout) ? options.timeout : 30000;
  const secrets = [config?.clientId, config?.clientSecret, config?.refreshToken];

  try {
    const response = await axiosInstance.post(
      'https://api.amazon.com/auth/o2/token',
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: config.refreshToken,
        client_id: config.clientId,
        client_secret: config.clientSecret,
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        },
        timeout,
      },
    );

    const accessToken = String(response.data?.access_token || '').trim();
    if (!accessToken) {
      throw Object.assign(new Error('Amazon Ads token minting succeeded without an access_token'), {
        code: 'AUTH_MALFORMED_RESPONSE',
      });
    }

    return accessToken;
  } catch (error) {
    throw normalizeAmazonAdsAuthError(error, { secrets });
  }
}

function normalizeAmazonAdsAuthError(error, { secrets = [] } = {}) {
  const normalized = new Error(redactSensitiveText(resolveErrorMessage(error), secrets));
  normalized.code = error.code === 'ECONNABORTED'
    ? 'AUTH_TIMEOUT'
    : error.code || (error.response ? 'AUTH_HTTP_ERROR' : 'AUTH_ERROR');
  normalized.httpStatus = error.response?.status || null;
  normalized.timeout = error.code === 'ECONNABORTED';
  return normalized;
}

function resolveErrorMessage(error) {
  if (!error) {
    return 'Unknown Amazon Ads auth error';
  }

  const candidates = [
    error.response?.data?.error_description,
    error.response?.data?.message,
    error.response?.data?.error,
    error.message,
  ];

  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return 'Unknown Amazon Ads auth error';
}

function redactSensitiveText(value, secrets = []) {
  let output = String(value || '');

  output = output.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]');
  output = output.replace(/https?:\/\/\S+/gi, '[redacted-url]');

  for (const secret of secrets) {
    if (!secret) continue;
    output = output.split(String(secret)).join('[redacted]');
  }

  return output;
}

module.exports = {
  mintAmazonAdsAccessToken,
  normalizeAmazonAdsAuthError,
  redactSensitiveText,
};
