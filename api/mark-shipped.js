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

  const { orderId, trackingNumber } = req.body;
  if (!orderId || !trackingNumber) {
    return res.status(400).json({ error: 'Missing orderId or trackingNumber' });
  }

  try {
    // 1. Update the Sheet: set tracking number + Status = "Shipped" on every row for this order
    const sheetRes = await fetch(SHEET_LOG_URL, {
      method: 'POST',
      body: JSON.stringify({ action: 'updateTracking', orderId, trackingNumber })
    });
    const order = await sheetRes.json();

    if (order.status !== 'ok') {
      return res.status(404).json({ error: 'Order not found in Sheet' });
    }

    // 2. Register the tracking number with EasyPost so we get a webhook when it's delivered.
    //    EasyPost uses HTTP Basic Auth with the API key as the username and no password.
    try {
      await fetch('https://api.easypost.com/v2/trackers', {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(process.env.EASYPOST_API_KEY + ':').toString('base64'),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tracker: { tracking_code: trackingNumber, carrier: 'UPS' }
        })
      });
    } catch (epErr) {
      // Don't block the "Shipped" email over an EasyPost hiccup — worst case, Delivered
      // detection needs to be retried manually later. Log it for now.
      console.error('EasyPost tracker registration failed:', epErr);
    }

    // 3. Send the "Shipped" email
    const trackUrl = `https://www.ups.com/track?loc=en_US&tracknum=${encodeURIComponent(trackingNumber)}&requester=WT/trackdetails`;
    const itemsHtml = order.items.map(function(label) {
      return `<li style="font-family:'Cormorant Garamond',Georgia,serif;font-size:16px;color:#2c2c2a;margin-bottom:4px;">${label}</li>`;
    }).join('');

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        // Once bioskinetics.com is verified as a sending domain in Resend, change this to:
        // 'Bioskinetics <orders@bioskinetics.com>'
        from: 'Bioskinetics <onboarding@resend.dev>',
        to: order.email,
        subject: 'Your Bioskinetics Order Has Shipped!',
        html: `
          <div style="max-width:520px;margin:0 auto;font-family:'Jost',Arial,sans-serif;color:#2c2c2a;">
            <div style="background:#000;padding:1.5rem;text-align:center;">
              <p style="font-family:'Playfair Display',Georgia,serif;color:#fade4b;font-size:20px;font-weight:700;margin:0;">Bioskinetics</p>
            </div>
            <div style="padding:2rem 1.5rem;text-align:center;">
              <h2 style="font-family:'Playfair Display',Georgia,serif;color:#b2a254;font-size:26px;margin:0 0 0.5rem;">Your Order Is On Its Way!</h2>
              <p style="font-size:15px;line-height:1.6;color:#5f5e5a;">Great news — your package just shipped via UPS.</p>
              <ul style="text-align:left;list-style:none;padding:0;margin:1.5rem 0;">${itemsHtml}</ul>
              <a href="${trackUrl}" style="display:inline-block;background:#fade4b;color:#2c2c2a;font-family:'Jost',Arial,sans-serif;font-size:13px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;text-decoration:none;border-radius:6px;padding:14px 32px;margin-top:0.5rem;">Track Your Package</a>
              <p style="font-size:13px;color:#9a9895;margin-top:1.5rem;">Tracking Number: ${trackingNumber}</p>
            </div>
          </div>
        `
      })
    });

    return res.status(200).json({ status: 'ok' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
