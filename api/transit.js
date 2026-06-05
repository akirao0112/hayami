const https = require('https');

// 駅の座標
const STATIONS = {
  '東村山': '35.754764,139.468658',
  '渋谷':   '35.658034,139.701636',
};

// 経由地（高田馬場）
const VIA_TAKADANOBABA = '35.712285,139.703726';

function httpsGet(url, headers) {
  return new Promise((resolve, reject) => {
    const options = {
      headers,
      method: 'GET',
    };
    https.get(url, options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(body) }); }
        catch (e) { reject(new Error('JSON parse error: ' + body.slice(0, 300))); }
      });
    }).on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    return res.status(204).end();
  }

  const apiKey = process.env.RAPID_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'RAPID_API_KEY が未設定です' });
  }

  const { from, to, departure } = req.query;
  if (!from || !to) {
    return res.status(400).json({ error: 'from と to は必須です' });
  }

  const startCoord = STATIONS[from];
  const goalCoord  = STATIONS[to];
  if (!startCoord || !goalCoord) {
    return res.status(400).json({ error: `未対応の駅名: ${from} / ${to}` });
  }

  // 現在時刻 or 指定時刻をISO形式に変換
  const now = departure ? new Date(
    departure.slice(0,4), departure.slice(4,6)-1, departure.slice(6,8),
    departure.slice(9,11), departure.slice(11,13)
  ) : new Date();
  const jstOffset = 9 * 60;
  const jst = new Date(now.getTime() + (jstOffset - now.getTimezoneOffset()) * 60000);
  const startTime = jst.toISOString().slice(0, 16) + ':00+09:00';

  const params = new URLSearchParams({
    start:      startCoord,
    goal:       goalCoord,
    via_list:   VIA_TAKADANOBABA,
    start_time: startTime,
    term:       '120',
    limit:      '5',
    datum:      'wgs84',
    coord_unit: 'degree',
  });

  const url = `https://navitime-route-totalnavi.p.rapidapi.com/route_transit?${params}`;

  try {
    const result = await httpsGet(url, {
      'X-RapidAPI-Key':  apiKey,
      'X-RapidAPI-Host': 'navitime-route-totalnavi.p.rapidapi.com',
    });

    if (result.status !== 200) {
      return res.status(result.status).json({ error: 'Navitime API error', detail: result.body });
    }

    // items[] から必要な情報だけ抽出して返す
    const items = (result.body.items ?? []).map(item => {
      const summary = item.summary ?? {};
      const sections = item.sections ?? [];

      // 最初の鉄道区間から列車種別を取得
      let trainName = '';
      for (const s of sections) {
        if (s.type === 'move' && s.transport?.type === 'train') {
          trainName = s.transport.service_name ?? s.transport.name ?? '';
          break;
        }
      }

      return {
        departure: summary.from?.time ?? '',
        arrival:   summary.to?.time   ?? '',
        trainName,
        duration:  summary.move?.time ?? 0,
      };
    });

    return res.status(200).json({ items });
  } catch (err) {
    console.error('transit proxy error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
