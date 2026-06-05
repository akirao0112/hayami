export default async function handler(req, res) {
  // CORS プリフライト
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    return res.status(204).end();
  }

  const appId = process.env.YAHOO_APP_ID;
  if (!appId) {
    return res.status(500).json({ error: 'YAHOO_APP_ID が設定されていません' });
  }

  const { from, to, via, departure, results = '5' } = req.query;
  if (!from || !to) {
    return res.status(400).json({ error: 'from と to は必須です' });
  }

  const url = new URL('https://map.yahooapis.jp/transit/V1/search');
  url.searchParams.set('appid',  appId);
  url.searchParams.set('from',   from);
  url.searchParams.set('to',     to);
  url.searchParams.set('output', 'json');
  url.searchParams.set('sort',   'time');
  url.searchParams.set('results', results);
  if (via)       url.searchParams.set('via',       via);
  if (departure) url.searchParams.set('departure', departure);

  const upstream = await fetch(url.toString());
  const data = await upstream.json();

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(upstream.status).json(data);
}
