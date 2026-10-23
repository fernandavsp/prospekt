const { createClient } = require('@supabase/supabase-js');
function send(res, status, body) { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); return res.status(status).json(body); }
module.exports = async (req, res) => {
  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(req.method)) return send(res, 405, { error: 'Método não permitido.' });
  const token = (req.headers.authorization || '').startsWith('Bearer ') ? req.headers.authorization.slice(7) : '';
  if (!token) return send(res, 401, { error: 'Faça login.' });
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  try {
    const { data: auth, error: authError } = await db.auth.getUser(token);
    if (authError || !auth.user) return send(res, 401, { error: 'Sessão inválida.' });
    const userId = auth.user.id;
    if (req.method === 'GET') {
      const { data, error } = await db.from('leads').select('id, payload, created_at, updated_at').eq('user_id', userId).order('updated_at', { ascending: false }).limit(2000);
      if (error) throw error;
      return send(res, 200, { leads: data || [] });
    }
    const body = req.body || {};
    if (req.method === 'POST') {
      if (!body.id || !body.payload || typeof body.payload !== 'object') return send(res, 400, { error: 'Lead inválido.' });
      const { data, error } = await db.from('leads').upsert({ user_id: userId, id: String(body.id).slice(0, 200), payload: body.payload, updated_at: new Date().toISOString() }, { onConflict: 'user_id,id' }).select('id,payload,created_at,updated_at').single();
      if (error) throw error;
      return send(res, 200, { lead: data });
    }
    const id = typeof body.id === 'string' ? body.id : '';
    if (!id) return send(res, 400, { error: 'ID do lead obrigatório.' });
    if (req.method === 'DELETE') {
      const { error } = await db.from('leads').delete().eq('user_id', userId).eq('id', id);
      if (error) throw error;
      return send(res, 200, { ok: true });
    }
    if (!body.payload || typeof body.payload !== 'object') return send(res, 400, { error: 'Dados do lead inválidos.' });
    const { data, error } = await db.from('leads').update({ payload: body.payload, updated_at: new Date().toISOString() }).eq('user_id', userId).eq('id', id).select('id,payload,created_at,updated_at').single();
    if (error) throw error;
    return send(res, 200, { lead: data });
  } catch (e) { console.error('leads api error', e.message); return send(res, 500, { error: 'Não foi possível salvar os leads.' }); }
};
