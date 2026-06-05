const https = require('https');

// 駅の座標（東村山は正確な駅座標を使用）
const STATIONS = {
  '東村山': '35.7558,139.4677',
  '渋谷':   '35.6580,139.7016',
};

function httpsGet(url, headers) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(body) }); }
        catch (e) { reject(new Error('JSON parse error: ' + body.slice(0, 300))); }
      });
    }).on('error', reject);
  });
}

// "2026-06-05T12:21:00+09:00" → "12:21"
function toHHMM(str) {
  return str ? str.slice(11, 16) : '--:--';
}

// "2026-06-05T12:21:00+09:00" → 分(0:00からの経過分)
function toMinutes(str) {
  if (!str || str.length < 16) return 0;
  return parseInt(str.slice(11, 13)) * 60 + parseInt(str.slice(14, 16));
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

  const { from, to, limit = '5' } = req.query;
  if (!from || !to) {
    return res.status(400).json({ error: 'from と to は必須です' });
  }

  const startCoord = STATIONS[from];
  const goalCoord  = STATIONS[to];
  if (!startCoord || !goalCoord) {
    return res.status(400).json({ error: `未対応の駅名: ${from} / ${to}` });
  }

  // 現在のJST時刻（タイムゾーンなし形式でNavitimeに渡す）
  const now = new Date();
  const jstMs = now.getTime() + 9 * 60 * 60 * 1000;
  const jstDate = new Date(jstMs);
  const startTime = jstDate.toISOString().slice(0, 19); // "2026-06-05T12:21:00"

  // 現在のJST分（diff計算用）
  const nowJstMins = Math.floor(jstMs / 60000) % (24 * 60);

  const params = new URLSearchParams({
    start:      startCoord,
    goal:       goalCoord,
    start_time: startTime,
    term:       '120',
    limit,
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

    // 行き（東村山→渋谷）は小平乗換が必要な国分寺線を除外
    const filterKodaira = (from === '東村山');

    const items = (result.body.items ?? [])
      .filter(item => {
        if (!filterKodaira) return true;
        return !item.sections?.some(s =>
          s.type === 'move' && s.transport?.name?.includes('国分寺線')
        );
      })
      .map(item => {
        const move = item.summary?.move ?? {};
        const sections = item.sections ?? [];

        // 鉄道区間を探して列車名と発時刻を取得
        let trainName = '';
        let depStr = '';
        for (const s of sections) {
          if (s.type === 'move' && s.transport) {
            trainName = s.transport.name ?? '';
            depStr    = s.from_time ?? '';
            break;
          }
        }

        const arrStr = move.to_time ?? '';
        const depMins = toMinutes(depStr);
        // Bug #1 fix: 過去の便は0クランプ（日付またぎは APIが現在時刻以降を返すため不要）
        const diff = Math.max(0, depMins - nowJstMins);

        return {
          depTime:   toHHMM(depStr),
          arrTime:   toHHMM(arrStr),
          diff,
          trainName,
        };
      })
      .slice(0, 3);

    return res.status(200).json({ items });
  } catch (err) {
    console.error('transit proxy error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
