const SHEET_LOG_URL = 'https://script.google.com/macros/s/AKfycbzkBB94SDwPVYV4HeZhTAnZ7lYijj65b-O2TXud0T_UjfbrJ93A2msRGp_FC6jqoqpE/exec';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Acknowledge quickly so EasyPost doesn't retry — do the actual work, then respond.
  const event = req.body;
  const result = event && event.result;

  if (!result || !result.tracking_code) {
    return res.status(200).json({ status: 'ignored' });
  }

  // EasyPost's tracker status field is "delivered" once UPS confirms delivery.
  if (result.status !== 'delivered') {
    return res.status(200).json({ status: 'ignored', trackerStatus: result.status });
  }

  try {
    const sheetRes = await fetch(SHEET_LOG_URL, {
      method: 'POST',
      body: JSON.stringify({ action: 'markDelivered', trackingNumber: result.tracking_code })
    });
    const order = await sheetRes.json();

    if (order.status !== 'ok' || !order.email) {
      return res.status(200).json({ status: 'order_not_found' });
    }

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
        subject: 'Your Bioskinetics Order Has Arrived!',
        html: `
          <div style="max-width:520px;margin:0 auto;font-family:'Jost',Arial,sans-serif;color:#2c2c2a;">
            <div style="background:#000;padding:1.5rem;text-align:center;">
              <p style="font-family:'Playfair Display',Georgia,serif;color:#fade4b;font-size:20px;font-weight:700;margin:0;">Bioskinetics</p>
            </div>
            <div style="padding:2rem 1.5rem;text-align:center;">
              <h2 style="font-family:'Playfair Display',Georgia,serif;color:#b2a254;font-size:26px;margin:0 0 0.5rem;">Your Order Has Arrived!</h2>
              <p style="font-size:15px;line-height:1.6;color:#5f5e5a;">Hi ${(order.name || '').split(' ')[0] || 'there'} — UPS just confirmed delivery of your package. We hope you love it!</p>
              <ul style="text-align:left;list-style:none;padding:0;margin:1.5rem 0;">${itemsHtml}</ul>
              <p style="font-size:14px;line-height:1.6;color:#5f5e5a;">Questions about your order? Just reply to this email — we're happy to help.</p>
            </div>
          </div>
        `
      })
    });

    return res.status(200).json({ status: 'ok' });
  } catch (err) {
    console.error('easypost-webhook error:', err);
    return res.status(200).json({ status: 'error', message: err.message }); // still 200 so EasyPost doesn't retry forever
  }
};
