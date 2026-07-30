const Stripe = require('stripe');
const SHEET_LOG_URL = 'https://script.google.com/macros/s/AKfycbzkBB94SDwPVYV4HeZhTAnZ7lYijj65b-O2TXud0T_UjfbrJ93A2msRGp_FC6jqoqpE/exec';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  const { sessionId, name, email, address, promoApplied, cart } = req.body;

  if (!sessionId) {
    return res.status(400).json({ error: 'Missing sessionId' });
  }

  // Verify with Stripe directly that this session actually completed payment —
  // never trust the client's word alone for something that triggers order fulfillment.
  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch (err) {
    return res.status(400).json({ error: 'Invalid session' });
  }

  if (session.payment_status !== 'paid') {
    return res.status(400).json({ error: 'Payment not completed' });
  }

  if (!Array.isArray(cart) || !cart.length) {
    return res.status(200).json({ status: 'ok', note: 'no cart items to log' });
  }

  // The Stripe session ID doubles as our internal Order ID — it's already unique
  // and stable, and ties every line-item row in the Sheet back to one order.
  const orderId = session.id;

  // Same $15-per-4-bottles logic as checkout session creation, waived when the
  // local-delivery promo was applied — mirrored here since this request doesn't
  // have direct access to the amount Stripe actually charged for shipping.
  const itemCount = cart.length;
  const shippingUnits = Math.ceil(itemCount / 4);
  const shippingAmount = promoApplied ? 0 : shippingUnits * 1500; // in cents
  const shippingSharePerItem = (shippingAmount / 100) / itemCount;

  try {
    await Promise.all(cart.map(function(item) {
      return fetch(SHEET_LOG_URL, {
        method: 'POST',
        body: JSON.stringify({
          action: 'logOrder',
          orderId: orderId,
          name: name || '',
          email: email || '',
          address: address || '',
          productName: item.productName || '',
          variant: item.variant || '',
          ingredients: item.baseIngredients || item.ingredients || '',
          scent: item.scent || 'Unscented',
          size: item.size || '',
          color: item.color || '',
          amount: (parseFloat(item.amount || 0) + shippingSharePerItem).toFixed(2)
        })
      });
    }));

    if (email) {
      await sendOrderReceivedEmail(email, name, cart, shippingAmount / 100);
    }

    return res.status(200).json({ status: 'ok' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

async function sendOrderReceivedEmail(email, name, cart, shippingAmount) {
  const subtotal = cart.reduce(function(sum, item) { return sum + parseFloat(item.amount || 0); }, 0);
  const total = subtotal + shippingAmount;

  const itemsHtml = cart.map(function(item) {
    const label = (item.productName || '') + (item.variant ? ' — ' + item.variant : '');
    return `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #ece8f0;">
          <div style="font-family:'Cormorant Garamond',Georgia,serif;font-size:17px;font-weight:600;color:#2c2c2a;">${label}</div>
          <div style="font-size:13px;color:#9a9895;">${[item.size, item.color, item.scent].filter(Boolean).join(' · ')}</div>
        </td>
        <td style="padding:10px 0;border-bottom:1px solid #ece8f0;text-align:right;font-family:'Cormorant Garamond',Georgia,serif;font-size:17px;font-weight:600;color:#2c2c2a;">
          $${parseFloat(item.amount || 0).toFixed(2)}
        </td>
      </tr>`;
  }).join('');

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Bioskinetics <orders@bioskinetics.com>',
        to: email,
        subject: 'Your Bioskinetics Order Is Confirmed',
        html: `
          <div style="max-width:520px;margin:0 auto;font-family:'Jost',Arial,sans-serif;color:#2c2c2a;">
            <div style="background:#000;padding:1.5rem;text-align:center;">
              <p style="font-family:'Playfair Display',Georgia,serif;color:#fade4b;font-size:20px;font-weight:700;margin:0;">Bioskinetics</p>
            </div>
            <div style="padding:2rem 1.5rem;">
              <h2 style="font-family:'Playfair Display',Georgia,serif;color:#b2a254;font-size:26px;margin:0 0 0.5rem;">Thank You, ${(name || '').split(' ')[0] || 'Friend'}!</h2>
              <p style="font-size:15px;line-height:1.6;color:#5f5e5a;">We're so excited to get your custom formula ready. Here's a summary of what you ordered:</p>
              <table style="width:100%;border-collapse:collapse;margin-top:1rem;">
                ${itemsHtml}
              </table>
              <div style="display:flex;justify-content:space-between;padding-top:1rem;font-size:14px;color:#5f5e5a;">
                <span>Subtotal</span><span>$${subtotal.toFixed(2)}</span>
              </div>
              <div style="display:flex;justify-content:space-between;font-size:14px;color:#5f5e5a;">
                <span>Shipping</span><span>$${shippingAmount.toFixed(2)}</span>
              </div>
              <div style="display:flex;justify-content:space-between;font-family:'Cormorant Garamond',Georgia,serif;font-size:20px;font-weight:600;color:#2c2c2a;padding-top:0.75rem;border-top:1px solid #ece8f0;margin-top:0.5rem;">
                <span>Total</span><span>$${total.toFixed(2)}</span>
              </div>
              <p style="font-size:14px;line-height:1.6;color:#5f5e5a;margin-top:1.5rem;">We'll send you another email with tracking info as soon as your order ships — orders ship out weekly, every Sunday.</p>
            </div>
          </div>
        `
      })
    });
  } catch (err) {
    // Don't fail the whole order-confirmation flow if the email hiccups — the order is
    // already logged and paid; just note it for later. Nothing to return to the client here.
    console.error('sendOrderReceivedEmail failed:', err);
  }
}
