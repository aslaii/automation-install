const axios = require('axios');

const REPORT_TYPE = 'GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL';
const REPORTS_BASE_URL = 'https://sellingpartnerapi-na.amazon.com/reports/2021-06-30';
const TERMINAL_FAILURE_STATUSES = new Set(['CANCELLED', 'FATAL']);
const ACTIVE_STATUSES = new Set(['IN_QUEUE', 'IN_PROGRESS', 'SUBMITTED']);

async function fetchOrdersReport({
  accessToken,
  marketplaceId,
  dateRange,
  axiosInstance = axios,
  sleep = defaultSleep,
  polling = {},
} = {}) {
  const lifecycle = [];
  const reportConfig = normalizePollingConfig(polling);

  const createResponse = await safeRequest({
    stage: 'create-report',
    lifecycle,
    attempt: 1,
    request: () => axiosInstance.post(
      `${REPORTS_BASE_URL}/reports`,
      {
        reportType: REPORT_TYPE,
        marketplaceIds: [marketplaceId],
        dataStartTime: `${dateRange.startDate}T00:00:00Z`,
        dataEndTime: `${dateRange.endDate}T23:59:59Z`,
      },
      {
        headers: spHeaders(accessToken),
        timeout: reportConfig.createTimeoutMs,
      },
    ),
  });

  if (!createResponse.ok) {
    return createResponse;
  }

  const reportId = String(createResponse.response.data?.reportId || '').trim();
  if (!reportId) {
    return fail({
      stage: 'create-report',
      lifecycle,
      attempts: { create: 1, poll: 0 },
      error: {
        code: 'MALFORMED_CREATE_RESPONSE',
        message: 'SP Reports create response did not include reportId',
      },
    });
  }

  lifecycle.push({ stage: 'create-report', attempt: 1, status: 'success', reportId });

  let lastStatus = 'UNKNOWN';
  for (let attempt = 1; attempt <= reportConfig.maxAttempts; attempt += 1) {
    const pollResult = await safeRequest({
      stage: 'poll-report',
      lifecycle,
      attempt,
      request: () => axiosInstance.get(`${REPORTS_BASE_URL}/reports/${reportId}`, {
        headers: {
          ...spHeaders(accessToken),
          Accept: 'application/json',
        },
        timeout: reportConfig.pollTimeoutMs,
      }),
    });

    if (!pollResult.ok) {
      return withAttempts(pollResult, { create: 1, poll: attempt });
    }

    const processingStatus = String(pollResult.response.data?.processingStatus || '').trim().toUpperCase();
    const reportDocumentId = String(pollResult.response.data?.reportDocumentId || '').trim();

    if (!processingStatus) {
      return fail({
        stage: 'poll-report',
        lifecycle,
        attempts: { create: 1, poll: attempt },
        reportId,
        error: {
          code: 'MALFORMED_POLL_RESPONSE',
          message: 'SP Reports poll response did not include processingStatus',
        },
      });
    }

    lastStatus = processingStatus;
    lifecycle.push({ stage: 'poll-report', attempt, status: processingStatus, reportId, reportDocumentId: reportDocumentId || null });

    if (TERMINAL_FAILURE_STATUSES.has(processingStatus)) {
      return fail({
        stage: 'poll-report',
        lifecycle,
        attempts: { create: 1, poll: attempt },
        reportId,
        processingStatus,
        error: {
          code: 'REPORT_TERMINAL_FAILURE',
          message: `SP report entered terminal status ${processingStatus}`,
        },
      });
    }

    if (processingStatus === 'DONE') {
      if (!reportDocumentId) {
        return fail({
          stage: 'poll-report',
          lifecycle,
          attempts: { create: 1, poll: attempt },
          reportId,
          processingStatus,
          error: {
            code: 'MALFORMED_POLL_RESPONSE',
            message: 'SP Reports poll response for DONE status did not include reportDocumentId',
          },
        });
      }

      return downloadReportDocument({
        accessToken,
        reportId,
        reportDocumentId,
        axiosInstance,
        lifecycle,
        attempts: { create: 1, poll: attempt },
        reportConfig,
      });
    }

    if (!ACTIVE_STATUSES.has(processingStatus)) {
      return fail({
        stage: 'poll-report',
        lifecycle,
        attempts: { create: 1, poll: attempt },
        reportId,
        processingStatus,
        error: {
          code: 'UNKNOWN_PROCESSING_STATUS',
          message: `Unexpected SP report processingStatus: ${processingStatus}`,
        },
      });
    }

    if (attempt < reportConfig.maxAttempts) {
      await sleep(reportConfig.pollIntervalMs);
    }
  }

  return fail({
    stage: 'poll-report',
    lifecycle,
    attempts: { create: 1, poll: reportConfig.maxAttempts },
    reportId,
    processingStatus: lastStatus,
    error: {
      code: 'POLL_TIMEOUT',
      message: `SP report did not reach DONE within ${reportConfig.maxAttempts} poll attempts`,
      timeout: true,
    },
  });
}

async function downloadReportDocument({
  accessToken,
  reportId,
  reportDocumentId,
  axiosInstance,
  lifecycle,
  attempts,
  reportConfig,
}) {
  const documentResponse = await safeRequest({
    stage: 'download-report',
    lifecycle,
    attempt: 1,
    request: () => axiosInstance.get(`${REPORTS_BASE_URL}/documents/${reportDocumentId}`, {
      headers: {
        ...spHeaders(accessToken),
        Accept: 'application/json',
      },
      timeout: reportConfig.documentTimeoutMs,
    }),
  });

  if (!documentResponse.ok) {
    return withAttempts(documentResponse, attempts, { reportId, reportDocumentId });
  }

  const downloadUrl = String(documentResponse.response.data?.url || '').trim();
  if (!downloadUrl) {
    return fail({
      stage: 'download-report',
      lifecycle,
      attempts,
      reportId,
      reportDocumentId,
      error: {
        code: 'MALFORMED_DOCUMENT_RESPONSE',
        message: 'SP report document response did not include url',
      },
    });
  }

  lifecycle.push({ stage: 'download-report', attempt: 1, status: 'document-ready', reportId, reportDocumentId });

  const fileResponse = await safeRequest({
    stage: 'download-report',
    lifecycle,
    attempt: 2,
    request: () => axiosInstance.get(downloadUrl, {
      responseType: 'arraybuffer',
      timeout: reportConfig.downloadTimeoutMs,
      transformResponse: [(data) => data],
    }),
  });

  if (!fileResponse.ok) {
    return withAttempts(fileResponse, attempts, { reportId, reportDocumentId });
  }

  const buffer = Buffer.isBuffer(fileResponse.response.data)
    ? fileResponse.response.data
    : Buffer.from(fileResponse.response.data || '');

  const contentType = String(fileResponse.response.headers?.['content-type'] || '').toLowerCase();
  if (isRejectedContentType(contentType)) {
    return fail({
      stage: 'download-report',
      lifecycle,
      attempts,
      reportId,
      reportDocumentId,
      error: {
        code: 'NON_TEXT_REPORT',
        message: `Report download returned non-text content-type: ${contentType || 'unknown'}`,
      },
    });
  }

  const reportText = buffer.toString('utf8');
  lifecycle.push({ stage: 'download-report', attempt: 2, status: 'success', reportId, reportDocumentId, bytes: buffer.length });

  return {
    ok: true,
    stage: 'download-report',
    reportId,
    reportDocumentId,
    processingStatus: 'DONE',
    attempts,
    lifecycle,
    reportText,
    contentType: contentType || 'unknown',
  };
}

async function safeRequest({ stage, lifecycle, attempt, request }) {
  try {
    const response = await request();
    return { ok: true, response };
  } catch (error) {
    lifecycle.push({
      stage,
      attempt,
      status: error.code === 'ECONNABORTED' ? 'timeout' : 'error',
      httpStatus: error.response?.status || null,
      message: error.response?.data?.message || error.message,
    });

    return fail({
      stage,
      lifecycle,
      error: normalizeHttpError(error),
    });
  }
}

function fail({ stage, lifecycle, attempts = { create: 0, poll: 0 }, error, reportId = null, reportDocumentId = null, processingStatus = null }) {
  return {
    ok: false,
    stage,
    attempts,
    lifecycle,
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

function normalizePollingConfig(polling) {
  return {
    maxAttempts: toPositiveInteger(polling.maxAttempts, 10),
    pollIntervalMs: toPositiveInteger(polling.pollIntervalMs, 60000),
    createTimeoutMs: toPositiveInteger(polling.createTimeoutMs, 30000),
    pollTimeoutMs: toPositiveInteger(polling.pollTimeoutMs, 30000),
    documentTimeoutMs: toPositiveInteger(polling.documentTimeoutMs, 30000),
    downloadTimeoutMs: toPositiveInteger(polling.downloadTimeoutMs, 30000),
  };
}

function toPositiveInteger(value, fallback) {
  if (!Number.isFinite(value)) return fallback;
  const normalized = Math.trunc(value);
  return normalized > 0 ? normalized : fallback;
}

function spHeaders(accessToken) {
  return {
    'x-amz-access-token': accessToken,
    'Content-Type': 'application/json',
  };
}

function normalizeHttpError(error) {
  return {
    code: error.code === 'ECONNABORTED' ? 'HTTP_TIMEOUT' : 'HTTP_ERROR',
    message: error.response?.data?.message || error.message,
    httpStatus: error.response?.status || null,
    timeout: error.code === 'ECONNABORTED',
  };
}

function isRejectedContentType(contentType) {
  if (!contentType) return false;
  return [
    'application/json',
    'application/pdf',
    'application/zip',
    'application/gzip',
    'application/octet-stream',
    'image/',
  ].some((value) => contentType.includes(value));
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  REPORT_TYPE,
  fetchOrdersReport,
};
