const https = require('https');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    return res.status(204).end();
  }

  const appId = process.env.YAHOO_APP_ID;
  if (!appId) {
    return res.status(500).json({ error: 'YAHOO_APP_ID が未設定です' });
  }

  const { from, to, via, departure, results = '5' } = req.query;
  if (!from || !to) {
    return res.status(400).json({ error: 'from と to は必須です' });
  }

  const params = new URLSearchParams({
    appid:   appId,
    from,
    to,
    output:  'json',
    sort:    'time',
    results,
    ...(via       ? { via }       : {}),
    ...(departure ? { departure } : {}),
  });

  const yahooUrl = `https://map.yahooapis.jp/transit/V1/search?${params}`;

  try {
    const data = await new Promise((resolve, reject) => {
      https.get(yahooUrl, (upstream) => {
        let body = '';
        upstream.on('data', chunk => body += chunk);
        upstream.on('end', () => {
          try { resolve({ status: upstream.statusCode, body: JSON.parse(body) }); }
          catch (e) { reject(new Error('JSON parse error: ' + body.slice(0, 200))); }
        });
      }).on('error', reject);
    });

    res.setHeader('Cache-Control', 'no-store');
    return res.status(data.status).json(data.body);
  } catch (err) {
    console.error('transit proxy error:', err);
    return res.status(500).json({ error: err.message });
  }
};
