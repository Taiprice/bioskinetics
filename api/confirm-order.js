const Stripe = require('stripe');
const SHEET_LOG_URL = 'https://script.google.com/macros/s/AKfycbzkBB94SDwPVYV4HeZhTAnZ7lYijj65b-O2TXud0T_UjfbrJ93A2msRGp_FC6jqoqpE/exec';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  const { sessionId, email, address, promoApplied, cart } = req.body;

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
    return res.status(200).json({ status: 'ok' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
