// In development Vite proxies /api/* → http://localhost:5000 (vite.config.js).
// Using a relative path means the browser calls the same origin → zero CORS issues.
// In production VITE_API_URL must be set to the deployed backend base URL.
const BASE_URL = import.meta.env.VITE_API_URL || '/api';

let inMemoryToken = null;

export function setAuthToken(token) {
  inMemoryToken = token;
}

export function getAuthToken() {
  return inMemoryToken;
}

async function request(path, { method = 'GET', body, headers = {} } = {}) {
  const url = `${BASE_URL}${path}`;

  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(inMemoryToken ? { Authorization: `Bearer ${inMemoryToken}` } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (networkErr) {
    // fetch() itself rejected — backend unreachable, DNS failure, etc.
    if (import.meta.env.DEV) {
      console.error('[api] Network error calling', url, networkErr);
    }
    throw new Error('Unable to connect to the server. Please check your connection and try again.');
  }

  let payload;
  try {
    payload = await res.json();
  } catch {
    throw new Error(`Unexpected response from server (status ${res.status}).`);
  }

  if (!res.ok) {
    const error = new Error(payload.message || `Request failed with status ${res.status}`);
    error.status = res.status;
    error.payload = payload;
    throw error;
  }

  return payload; // { success, message, data }
}

export const api = {
  get:    (path)        => request(path),
  post:   (path, body)  => request(path, { method: 'POST',  body }),
  put:    (path, body)  => request(path, { method: 'PUT',   body }),
  patch:  (path, body)  => request(path, { method: 'PATCH', body }),
  delete: (path)        => request(path, { method: 'DELETE' }),
};
