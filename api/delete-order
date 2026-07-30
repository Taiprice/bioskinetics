const SHEET_LOG_URL = 'https://script.google.com/macros/s/AKfycbzkBB94SDwPVYV4HeZhTAnZ7lYijj65b-O2TXud0T_UjfbrJ93A2msRGp_FC6jqoqpE/exec';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-secret');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (req.headers['x-admin-secret'] !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { orderId } = req.body;
  if (!orderId) return res.status(400).json({ error: 'Missing orderId' });

  try {
    const sheetRes = await fetch(SHEET_LOG_URL, {
      method: 'POST',
      body: JSON.stringify({ action: 'deleteOrder', orderId })
    });
    const data = await sheetRes.json();
    if (data.status !== 'ok') {
      return res.status(404).json({ error: 'Order not found in Sheet' });
    }
    return res.status(200).json({ status: 'ok' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
