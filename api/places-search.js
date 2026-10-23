const { createClient } = require('@supabase/supabase-js');

const LIMIT = Math.max(1, Number.parseInt(process.env.FREE_SEARCH_LIMIT || '5', 10));
const FIELDS = [
  'places.id', 'places.displayName', 'places.formattedAddress', 'places.nationalPhoneNumber',
  'places.websiteUri', 'places.rating', 'places.userRatingCount', 'places.googleMapsUri',
  'places.businessStatus', 'nextPageToken'
].join(',');

function json(res, status, body) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json(body);
}
function adminClient() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}
async function authenticate(req, res) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) { json(res, 401, { error: 'Faça login para continuar.' }); return null; }
  const supabase = adminClient();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) { json(res, 401, { error: 'Sessão inválida ou expirada. Entre novamente.' }); return null; }
  return { supabase, user: data.user };
}
module.exports = async (req, res) => {
  if (!['GET', 'POST'].includes(req.method)) return json(res, 405, { error: 'Método não permitido.' });
  try {
    const auth = await authenticate(req, res);
    if (!auth) return;
    const { supabase, user } = auth;
    const { data: quotaRows, error: quotaError } = await supabase.rpc('consume_search_quota', {
      p_user_id: user.id, p_limit: LIMIT, p_consume: req.method === 'POST'
    });
    if (quotaError) {
      console.error('quota rpc error', quotaError.message);
      return json(res, 500, { error: 'Não foi possível validar seu limite de pesquisas.' });
    }
    const quota = Array.isArray(quotaRows) ? quotaRows[0] : quotaRows;
    if (!quota) return json(res, 500, { error: 'Resposta inválida ao verificar limite.' });
    if (req.method === 'GET') return json(res, 200, { remaining: quota.remaining, limit: LIMIT });
    if (!quota.allowed) return json(res, 429, { error: 'Você atingiu o limite de pesquisas gratuitas. Entre em contato para liberar um plano.', remaining: 0, limit: LIMIT });
    if (!process.env.GOOGLE_PLACES_API_KEY) return json(res, 500, { error: 'A chave da Google Places API não está configurada no servidor.', remaining: quota.remaining, limit: LIMIT });
    const textQuery = typeof req.body?.textQuery === 'string' ? req.body.textQuery.trim() : '';
    const pageToken = typeof req.body?.pageToken === 'string' ? req.body.pageToken : null;
    if (!textQuery || textQuery.length > 180) return json(res, 400, { error: 'Informe um segmento e uma cidade válidos.', remaining: quota.remaining, limit: LIMIT });
    const body = { textQuery, languageCode: 'pt-BR', regionCode: 'BR', pageSize: 20 };
    if (pageToken) body.pageToken = pageToken;
    const upstream = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': process.env.GOOGLE_PLACES_API_KEY, 'X-Goog-FieldMask': FIELDS },
      body: JSON.stringify(body)
    });
    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      console.error('Google Places error', upstream.status, data?.error?.message);
      return json(res, 502, { error: 'O serviço de busca não conseguiu responder. Tente novamente mais tarde.', remaining: quota.remaining, limit: LIMIT });
    }
    return json(res, 200, { ...data, remaining: quota.remaining, limit: LIMIT });
  } catch (e) {
    console.error('places-search error', e);
    return json(res, 500, { error: 'Erro interno ao processar a busca.' });
  }
};
