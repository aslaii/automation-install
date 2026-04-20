const axios = require('axios');
const zlib = require('zlib');
const { redactSensitiveText } = require('../auth/amazon-ads');

const AMAZON_ADS_REPORTS_BASE_URL = 'https://advertising-api.amazon.com';
const ACTIVE_STATUSES = new Set(['PENDING', 'PROCESSING', 'IN_PROGRESS', 'IN_QUEUE', 'SUBMITTED']);
const TERMINAL_FAILURE_STATUSES = new Set(['FAILED', 'CANCELLED']);
const GZIP_MAGIC_BYTE_1 = 0x1f;
const GZIP_MAGIC_BYTE_2 = 0x8b;

async function runAmazonAdsReportLifecycle({
  accessToken,
  clientId,
  profileId,
  dateRange,
  reportConfig,
  polling = {},
  axiosInstance = axios,
  sleep = defaultSleep,
  random = Math.random,
  zlibImpl = zlib,
} = {}) {
  const lifecycle = [];
  const normalizedReportConfig = normalizeReportConfig(reportConfig);
  const normalizedPolling = normalizePollingConfig(polling);
  const secrets = [accessToken, clientId, profileId];

  const createResult = await createReport({
    accessToken,
    clientId,
    profileId,
    dateRange,
    reportConfig: normalizedReportConfig,
    axiosInstance,
    timeout: normalizedPolling.createTimeoutMs,
    lifecycle,
    secrets,
  });

  if (!createResult.ok) {
    return createResult;
  }

  const reportId = createResult.reportId;
  let processingStatus = 'UNKNOWN';
  let reportDocumentId = null;

  for (let attempt = 1; attempt <= normalizedPolling.maxAttempts; attempt += 1) {
    const pollResult = await pollReport({
      attempt,
      reportId,
      accessToken,
      clientId,
      profileId,
      axiosInstance,
      timeout: normalizedPolling.pollTimeoutMs,
      lifecycle,
      secrets,
    });

    if (!pollResult.ok) {
      if (pollResult.error.code === 'THROTTLED' && attempt < normalizedPolling.maxAttempts) {
        const delayMs = computeThrottleDelayMs({
          attempt,
          retryAfterMs: pollResult.error.retryAfterMs,
          polling: normalizedPolling,
          random,
        });
        lifecycle.push({
          stage: 'poll-report',
          attempt,
          status: 'throttled',
          reportId,
          httpStatus: pollResult.error.httpStatus || 429,
          retryAfterMs: pollResult.error.retryAfterMs || null,
          delayMs,
          message: pollResult.error.message,
        });
        await sleep(delayMs);
        continue;
      }

      return withAttempts(pollResult, { create: 1, poll: attempt }, { reportId, reportDocumentId, processingStatus });
    }

    processingStatus = String(pollResult.response.data?.status || '').trim().toUpperCase();
    reportDocumentId = normalizeNullableString(
      pollResult.response.data?.reportDocumentId
      || pollResult.response.data?.reportId
      || null,
    );
    const downloadUrl = normalizeNullableString(pollResult.response.data?.url || pollResult.response.data?.location || null);
    const failureReason = normalizeNullableString(pollResult.response.data?.failureReason || null);

    if (!processingStatus) {
      return fail({
        stage: 'poll-report',
        lifecycle,
        attempts: { create: 1, poll: attempt },
        reportId,
        error: {
          code: 'MALFORMED_POLL_RESPONSE',
          message: 'Amazon Ads poll response did not include status',
          httpStatus: null,
          timeout: false,
        },
      });
    }

    lifecycle.push({
      stage: 'poll-report',
      attempt,
      status: processingStatus,
      reportId,
      reportDocumentId,
      message: failureReason || '',
    });

    if (TERMINAL_FAILURE_STATUSES.has(processingStatus)) {
      return fail({
        stage: 'poll-report',
        lifecycle,
        attempts: { create: 1, poll: attempt },
        reportId,
        reportDocumentId,
        processingStatus,
        error: {
          code: 'REPORT_TERMINAL_FAILURE',
          message: `Amazon Ads report ${processingStatus}: ${failureReason || 'No failure reason provided'}`,
          httpStatus: null,
          timeout: false,
        },
      });
    }

    if (processingStatus === 'COMPLETED') {
      if (!downloadUrl) {
        return fail({
          stage: 'poll-report',
          lifecycle,
          attempts: { create: 1, poll: attempt },
          reportId,
          reportDocumentId,
          processingStatus,
          error: {
            code: 'MALFORMED_POLL_RESPONSE',
            message: 'Amazon Ads COMPLETED report did not include a download url',
            httpStatus: null,
            timeout: false,
          },
        });
      }

      return downloadReport({
        reportId,
        reportDocumentId,
        processingStatus,
        downloadUrl,
        axiosInstance,
        timeout: normalizedPolling.downloadTimeoutMs,
        lifecycle,
        attempts: { create: 1, poll: attempt },
        secrets,
        zlibImpl,
      });
    }

    if (!ACTIVE_STATUSES.has(processingStatus)) {
      return fail({
        stage: 'poll-report',
        lifecycle,
        attempts: { create: 1, poll: attempt },
        reportId,
        reportDocumentId,
        processingStatus,
        error: {
          code: 'UNKNOWN_PROCESSING_STATUS',
          message: `Unexpected Amazon Ads report status: ${processingStatus}`,
          httpStatus: null,
          timeout: false,
        },
      });
    }

    if (attempt < normalizedPolling.maxAttempts) {
      await sleep(normalizedPolling.pollIntervalMs);
    }
  }

  return fail({
    stage: 'poll-report',
    lifecycle,
    attempts: { create: 1, poll: normalizedPolling.maxAttempts },
    reportId,
    reportDocumentId,
    processingStatus,
    error: {
      code: 'POLL_TIMEOUT',
      message: `Amazon Ads report did not reach COMPLETED within ${normalizedPolling.maxAttempts} poll attempts`,
      httpStatus: null,
      timeout: true,
    },
  });
}

async function createReport({ accessToken, clientId, profileId, dateRange, reportConfig, axiosInstance, timeout, lifecycle, secrets }) {
  const requestBody = {
    name: `${reportConfig.namePrefix}_${dateRange.startDate}_${Date.now()}`,
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    configuration: {
      adProduct: reportConfig.adProduct,
      reportTypeId: reportConfig.reportTypeId,
      format: reportConfig.format,
      timeUnit: reportConfig.timeUnit,
      groupBy: reportConfig.groupBy,
      columns: reportConfig.columns,
    },
  };

  try {
    const response = await axiosInstance.post(
      `${AMAZON_ADS_REPORTS_BASE_URL}/reporting/reports`,
      requestBody,
      {
        headers: adsHeaders({ accessToken, clientId, profileId }),
        timeout,
      },
    );

    const reportId = normalizeNullableString(response.data?.reportId);
    if (!reportId) {
      return fail({
        stage: 'create-report',
        lifecycle,
        attempts: { create: 1, poll: 0 },
        error: {
          code: 'MALFORMED_CREATE_RESPONSE',
          message: 'Amazon Ads create-report response did not include reportId',
          httpStatus: response.status || null,
          timeout: false,
        },
      });
    }

    lifecycle.push({ stage: 'create-report', attempt: 1, status: 'success', reportId });
    return { ok: true, reportId };
  } catch (error) {
    const normalized = normalizeAdsError(error, { secrets });
    const duplicateReportId = extractDuplicateReportId(normalized.message);

    if (duplicateReportId) {
      lifecycle.push({
        stage: 'create-report',
        attempt: 1,
        status: 'duplicate-reused',
        reportId: duplicateReportId,
        httpStatus: normalized.httpStatus,
        message: normalized.message,
      });
      return { ok: true, reportId: duplicateReportId, duplicateRecovered: true };
    }

    lifecycle.push({
      stage: 'create-report',
      attempt: 1,
      status: normalized.timeout ? 'timeout' : 'error',
      httpStatus: normalized.httpStatus,
      message: normalized.message,
    });

    return fail({
      stage: 'create-report',
      lifecycle,
      attempts: { create: 1, poll: 0 },
      error: normalized,
    });
  }
}

async function pollReport({ attempt, reportId, accessToken, clientId, profileId, axiosInstance, timeout, lifecycle, secrets }) {
  try {
    const response = await axiosInstance.get(
      `${AMAZON_ADS_REPORTS_BASE_URL}/reporting/reports/${reportId}`,
      {
        headers: adsHeaders({ accessToken, clientId, profileId }),
        timeout,
      },
    );
    return { ok: true, response };
  } catch (error) {
    const normalized = normalizeAdsError(error, { secrets });
    if (normalized.code === 'THROTTLED') {
      return fail({
        stage: 'poll-report',
        lifecycle,
        error: normalized,
      });
    }

    lifecycle.push({
      stage: 'poll-report',
      attempt,
      status: normalized.timeout ? 'timeout' : 'error',
      reportId,
      httpStatus: normalized.httpStatus,
      message: normalized.message,
    });

    return fail({
      stage: 'poll-report',
      lifecycle,
      error: normalized,
    });
  }
}

async function downloadReport({ reportId, reportDocumentId, processingStatus, downloadUrl, axiosInstance, timeout, lifecycle, attempts, secrets, zlibImpl }) {
  try {
    const response = await axiosInstance.get(downloadUrl, {
      responseType: 'arraybuffer',
      timeout,
      transformResponse: [(data) => data],
    });

    const decoded = decodeReportDownload({
      data: response.data,
      headers: response.headers || {},
      zlibImpl,
    });

    lifecycle.push({
      stage: 'download-report',
      attempt: 1,
      status: 'success',
      reportId,
      reportDocumentId,
      bytes: decoded.bytes,
      contentType: decoded.contentType,
      encoding: decoded.encoding,
    });

    return {
      ok: true,
      stage: 'download-report',
      attempts,
      lifecycle,
      reportId,
      reportDocumentId,
      processingStatus,
      reportText: decoded.text,
      contentType: decoded.contentType,
      download: {
        bytes: decoded.bytes,
        compressedBytes: decoded.compressedBytes,
        encoding: decoded.encoding,
      },
    };
  } catch (error) {
    const normalized = error.code && error.code.startsWith('MALFORMED_')
      ? error
      : normalizeAdsError(error, { secrets });

    lifecycle.push({
      stage: 'download-report',
      attempt: 1,
      status: normalized.timeout ? 'timeout' : 'error',
      reportId,
      reportDocumentId,
      httpStatus: normalized.httpStatus || null,
      message: normalized.message,
    });

    return fail({
      stage: 'download-report',
      lifecycle,
      attempts,
      reportId,
      reportDocumentId,
      processingStatus,
      error: {
        code: normalized.code || 'DOWNLOAD_ERROR',
        message: normalized.message,
        httpStatus: normalized.httpStatus || null,
        timeout: Boolean(normalized.timeout),
      },
    });
  }
}

function decodeReportDownload({ data, headers = {}, zlibImpl = zlib }) {
  const compressedBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data || '');
  const contentType = String(headers['content-type'] || 'application/octet-stream').toLowerCase();
  const contentEncoding = String(headers['content-encoding'] || '').toLowerCase();
  const gzipEncoded = contentEncoding.includes('gzip') || looksLikeGzip(compressedBuffer);

  let decodedBuffer = compressedBuffer;
  if (gzipEncoded) {
    try {
      decodedBuffer = zlibImpl.gunzipSync(compressedBuffer);
    } catch (error) {
      const wrapped = new Error('Amazon Ads download could not be decompressed as gzip');
      wrapped.code = 'MALFORMED_DOWNLOAD_GZIP';
      throw wrapped;
    }
  }

  if (decodedBuffer.includes(0)) {
    const wrapped = new Error('Amazon Ads download did not decode into UTF-8 text');
    wrapped.code = 'MALFORMED_DOWNLOAD_CONTENT';
    throw wrapped;
  }

  const text = decodedBuffer.toString('utf8');
  if (!text.trim()) {
    const wrapped = new Error('Amazon Ads download decoded to empty text');
    wrapped.code = 'MALFORMED_DOWNLOAD_CONTENT';
    throw wrapped;
  }

  return {
    text,
    bytes: decodedBuffer.length,
    compressedBytes: compressedBuffer.length,
    contentType,
    encoding: gzipEncoded ? 'gzip' : 'identity',
  };
}

function normalizeAdsError(error, { secrets = [] } = {}) {
  const message = redactSensitiveText(resolveErrorMessage(error), secrets);
  const httpStatus = error.response?.status || null;
  const timeout = error.code === 'ECONNABORTED';
  const retryAfterMs = parseRetryAfterMs(error.response?.headers?.['retry-after']);

  return {
    code: isThrottleError(error) ? 'THROTTLED' : timeout ? 'HTTP_TIMEOUT' : 'HTTP_ERROR',
    message,
    httpStatus,
    timeout,
    retryAfterMs,
  };
}

function resolveErrorMessage(error) {
  const candidates = [
    error.response?.data?.details,
    error.response?.data?.detail,
    error.response?.data?.message,
    error.response?.data?.error?.details,
    error.response?.data?.error_description,
    error.message,
  ];

  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return 'Unknown Amazon Ads API error';
}

function adsHeaders({ accessToken, clientId, profileId }) {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Amazon-Advertising-API-ClientId': clientId,
    'Amazon-Advertising-API-Scope': profileId,
    Accept: 'application/vnd.createasyncreportrequest.v3+json',
    'Content-Type': 'application/json',
  };
}

function extractDuplicateReportId(message) {
  const match = String(message || '').match(/duplicate of\s*:\s*([a-z0-9-]+)/i);
  return match ? match[1] : null;
}

function parseRetryAfterMs(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed * 1000 : null;
}

function computeThrottleDelayMs({ attempt, retryAfterMs, polling, random = Math.random }) {
  const base = Math.min(
    polling.maxRetryDelayMs,
    polling.baseRetryDelayMs * (2 ** Math.max(0, attempt - 1)),
  );
  const jitter = Math.floor(Math.max(0, polling.jitterMaxMs) * random());
  return Math.max(base + jitter, retryAfterMs || 0, polling.pollIntervalMs);
}

function normalizePollingConfig(polling = {}) {
  return {
    maxAttempts: toPositiveInteger(polling.maxAttempts, 10),
    pollIntervalMs: toPositiveInteger(polling.pollIntervalMs, 60000),
    createTimeoutMs: toPositiveInteger(polling.createTimeoutMs, 30000),
    pollTimeoutMs: toPositiveInteger(polling.pollTimeoutMs, 30000),
    downloadTimeoutMs: toPositiveInteger(polling.downloadTimeoutMs, 30000),
    baseRetryDelayMs: toPositiveInteger(polling.baseRetryDelayMs, 60000),
    maxRetryDelayMs: toPositiveInteger(polling.maxRetryDelayMs, 300000),
    jitterMaxMs: toPositiveIntegerOrZero(polling.jitterMaxMs, 30000),
  };
}

function normalizeReportConfig(reportConfig = {}) {
  const columns = Array.isArray(reportConfig.columns) && reportConfig.columns.length > 0
    ? reportConfig.columns.map((value) => String(value))
    : ['advertisedSku', 'sales7d', 'attributedSales7d'];

  return {
    namePrefix: String(reportConfig.namePrefix || 'SKU_Sales_PPC'),
    adProduct: String(reportConfig.adProduct || 'SPONSORED_PRODUCTS'),
    reportTypeId: String(reportConfig.reportTypeId || 'spAdvertisedProduct'),
    format: String(reportConfig.format || 'GZIP_JSON'),
    timeUnit: String(reportConfig.timeUnit || 'DAILY'),
    groupBy: Array.isArray(reportConfig.groupBy) && reportConfig.groupBy.length > 0
      ? reportConfig.groupBy.map((value) => String(value))
      : ['advertiser'],
    columns,
  };
}

function fail({ stage, lifecycle, attempts = { create: 0, poll: 0 }, error, reportId = null, reportDocumentId = null, processingStatus = null }) {
  return {
    ok: false,
    stage,
    lifecycle,
    attempts,
    reportId,
    reportDocumentId,
    processingStatus,
    error,
  };
}

function withAttempts(result, attempts, extra = {}) {
  return {
    ...result,
    attempts,
    ...extra,
  };
}

function toPositiveInteger(value, fallback) {
  if (!Number.isFinite(value)) return fallback;
  const normalized = Math.trunc(value);
  return normalized > 0 ? normalized : fallback;
}

function toPositiveIntegerOrZero(value, fallback) {
  if (!Number.isFinite(value)) return fallback;
  const normalized = Math.trunc(value);
  return normalized >= 0 ? normalized : fallback;
}

function isThrottleError(error) {
  const message = String(resolveErrorMessage(error)).toLowerCase();
  return error.response?.status === 429 || message.includes('too many requests') || message.includes('throttl');
}

function normalizeNullableString(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function looksLikeGzip(buffer) {
  return Buffer.isBuffer(buffer)
    && buffer.length >= 2
    && buffer[0] === GZIP_MAGIC_BYTE_1
    && buffer[1] === GZIP_MAGIC_BYTE_2;
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  AMAZON_ADS_REPORTS_BASE_URL,
  runAmazonAdsReportLifecycle,
  decodeReportDownload,
  extractDuplicateReportId,
  parseRetryAfterMs,
  computeThrottleDelayMs,
  normalizeAdsError,
};
