module.exports = String.raw`(function () {
  const CSRF_STORAGE_KEY = 'docsync.swagger.csrfToken';
  const TENANT_STORAGE_KEY = 'docsync.swagger.tenantId';
  const LOGOUT_PATHS = new Set(['/api/sessions/logout', '/api/sessions/sessions/revoke-all']);

  function getUi() {
    return window.ui || null;
  }

  function getCsrfToken() {
    try {
      return window.sessionStorage.getItem(CSRF_STORAGE_KEY) || '';
    } catch {
      return '';
    }
  }

  function setCsrfToken(token) {
    if (typeof token !== 'string' || !token) return;
    try {
      window.sessionStorage.setItem(CSRF_STORAGE_KEY, token);
    } catch {}
  }

  function getTenantId() {
    try {
      return window.sessionStorage.getItem(TENANT_STORAGE_KEY) || '';
    } catch {
      return '';
    }
  }

  function setTenantId(tenantId) {
    if (typeof tenantId !== 'string' || !tenantId) return;
    try {
      window.sessionStorage.setItem(TENANT_STORAGE_KEY, tenantId);
    } catch {}
  }

  function clearStoredSessionContext() {
    try {
      window.sessionStorage.removeItem(CSRF_STORAGE_KEY);
      window.sessionStorage.removeItem(TENANT_STORAGE_KEY);
    } catch {}
  }

  function clearAuthorization() {
    clearStoredSessionContext();
    const ui = getUi();
    if (!ui?.authActions?.logout) return;
    try {
      ui.authActions.logout(['bearerAuth']);
    } catch {
      try {
        ui.authActions.logout();
      } catch {}
    }
  }

  function applyAuthorization(payload) {
    if (!payload || typeof payload !== 'object') return;
    if (typeof payload.csrfToken === 'string' && payload.csrfToken) {
      setCsrfToken(payload.csrfToken);
    }
    const currentTenantId = typeof payload?.user?.currentTenantId === 'string'
      ? payload.user.currentTenantId
      : typeof payload?.tenantId === 'string'
        ? payload.tenantId
        : '';
    if (currentTenantId) {
      setTenantId(currentTenantId);
    }
    if (typeof payload.accessToken !== 'string' || !payload.accessToken) return;

    const ui = getUi();
    if (!ui) return;

    try {
      if (typeof ui.preauthorizeApiKey === 'function') {
        ui.preauthorizeApiKey('bearerAuth', payload.accessToken);
        return;
      }
    } catch {}

    try {
      if (typeof ui.authActions?.authorize === 'function') {
        ui.authActions.authorize({
          bearerAuth: {
            name: 'bearerAuth',
            schema: {
              type: 'http',
              scheme: 'bearer',
              bearerFormat: 'JWT',
            },
            value: payload.accessToken,
          },
        });
      }
    } catch {}
  }

  function resolveRequestUrl(input) {
    if (typeof input === 'string' || input instanceof URL) return input.toString();
    if (input && typeof input.url === 'string') return input.url;
    return '';
  }

  function isSameOriginApi(url) {
    return url.origin === window.location.origin && url.pathname.startsWith('/api/');
  }

  function withStoredHeaders(input, init) {
    const rawUrl = resolveRequestUrl(input);
    if (!rawUrl) return { input, init };

    const url = new URL(rawUrl, window.location.origin);
    if (!isSameOriginApi(url)) return { input, init };

    const nextInit = {
      ...(init || {}),
      credentials: (init && init.credentials) || 'same-origin',
    };

    const headers = new Headers(nextInit.headers || (input instanceof Request ? input.headers : undefined));

    const tenantId = getTenantId();
    if (tenantId && !headers.has('x-tenant-id')) {
      headers.set('x-tenant-id', tenantId);
    }

    const method = String(nextInit.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
      const csrfToken = getCsrfToken();
      if (csrfToken && !headers.has('x-csrf-token')) {
        headers.set('x-csrf-token', csrfToken);
      }
    }

    return {
      input,
      init: {
        ...nextInit,
        headers,
      },
    };
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = async function swaggerAutoAuthorizeFetch(input, init) {
    const prepared = withStoredHeaders(input, init);
    const response = await originalFetch(prepared.input, prepared.init);

    try {
      const rawUrl = resolveRequestUrl(prepared.input);
      if (!rawUrl) return response;

      const url = new URL(rawUrl, window.location.origin);
      if (!isSameOriginApi(url)) return response;

      if (LOGOUT_PATHS.has(url.pathname) && response.ok) {
        clearAuthorization();
        return response;
      }

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) return response;

      const payload = await response.clone().json();
      if (payload && typeof payload === 'object') {
        if (typeof payload.accessToken === 'string' && payload.accessToken) {
          applyAuthorization(payload);
        } else {
          if (typeof payload.csrfToken === 'string' && payload.csrfToken) {
            setCsrfToken(payload.csrfToken);
          }
          const currentTenantId = typeof payload?.user?.currentTenantId === 'string'
            ? payload.user.currentTenantId
            : typeof payload?.tenantId === 'string'
              ? payload.tenantId
              : '';
          if (currentTenantId) {
            setTenantId(currentTenantId);
          }
        }
      }
    } catch {}

    return response;
  };
})();`;