const defaultBaseUrl = 'http://localhost:4010';

function getBillingServiceBaseUrl() {
  return String(process.env.BILLING_SERVICE_URL || defaultBaseUrl).replace(/\/+$/, '');
}

function getBillingServiceToken() {
  return String(process.env.BILLING_SERVICE_TOKEN || '').trim();
}

function toQueryString(query = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const serialized = params.toString();
  return serialized ? `?${serialized}` : '';
}

async function parseResponseBody(response) {
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('application/json')) {
    return response.json();
  }
  return response.text();
}

async function requestBillingService(pathname, { method = 'GET', body = null, query = {} } = {}) {
  const baseUrl = getBillingServiceBaseUrl();
  const token = getBillingServiceToken();
  const url = `${baseUrl}${pathname}${toQueryString(query)}`;

  const headers = {
    Accept: 'application/json',
  };

  if (token) {
    headers['x-service-token'] = token;
  }

  if (body !== null && body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body !== null && body !== undefined ? JSON.stringify(body) : undefined,
  });

  const payload = await parseResponseBody(response);
  return {
    ok: response.ok,
    status: response.status,
    payload,
  };
}

module.exports = {
  requestBillingService,
};
