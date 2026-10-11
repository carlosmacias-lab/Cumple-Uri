// Copa Pabs API: everyone can read the tournament; only the admin password can change it.
// Data lives in Upstash Redis (connected from the Vercel Marketplace).
const crypto = require('crypto');

const KEY = 'copa-pabs:state';
const MAX_BYTES = 500000;

function redisConfig() {
  return {
    url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
  };
}

async function redis(command) {
  const { url, token } = redisConfig();
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error || `Redis respondió ${res.status}`);
  return data.result;
}

function passwordMatches(given) {
  const real = process.env.ADMIN_PASSWORD || '';
  if (!real || typeof given !== 'string' || !given) return false;
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(real).digest();
  return crypto.timingSafeEqual(a, b);
}

function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return {};
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  const { url, token } = redisConfig();
  if (!url || !token) {
    return res.status(500).json({ error: 'Falta conectar la base de datos (Upstash) al proyecto en Vercel.' });
  }

  try {
    if (req.method === 'GET') {
      const raw = await redis(['GET', KEY]);
      return res.status(200).json({ state: raw ? JSON.parse(raw) : null });
    }

    if (req.method === 'POST') {
      if (!process.env.ADMIN_PASSWORD) {
        return res.status(500).json({ error: 'Falta configurar ADMIN_PASSWORD en Vercel.' });
      }
      const body = readBody(req);
      if (!passwordMatches(body.password)) {
        return res.status(401).json({ error: 'Contraseña incorrecta.' });
      }
      if (body.check) return res.status(200).json({ ok: true });

      const state = body.state;
      if (!state || !Array.isArray(state.teams) || !Array.isArray(state.matches)) {
        return res.status(400).json({ error: 'Los datos del torneo no son válidos.' });
      }
      const raw = JSON.stringify(state);
      if (raw.length > MAX_BYTES) return res.status(413).json({ error: 'Demasiados datos para guardar.' });
      await redis(['SET', KEY, raw]);
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Método no permitido.' });
  } catch (err) {
    return res.status(502).json({ error: 'No se pudo conectar con la base de datos.' });
  }
};
