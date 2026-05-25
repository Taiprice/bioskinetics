const Stripe = require('stripe');
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  const { amount, productName, variant, ingredients, itemCount } = req.body;
  if (!amount || amount < 1) {
    return res.status(400).json({ error: 'Invalid amount' });
  }

  // $15 per 4 bottles (rounded up)
  const count = parseInt(itemCount) || 1;
  const shippingUnits = Math.ceil(count / 4);
  const shippingAmount = shippingUnits * 1500; // in cents

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: `${productName} — ${variant}`,
            description: ingredients || 'Custom formula',
          },
          unit_amount: Math.round(amount * 100),
        },
        quantity: 1,
      }],
      mode: 'payment',
      ui_mode: 'embedded',
      shipping_options: [
        {
          shipping_rate_data: {
            type: 'fixed_amount',
            fixed_amount: { amount: shippingAmount, currency: 'usd' },
            display_name: `Standard Shipping (${count} item${count !== 1 ? 's' : ''})`,
            delivery_estimate: {
              minimum: { unit: 'business_day', value: 5 },
              maximum: { unit: 'business_day', value: 7 },
            },
          },
        },
      ],
      return_url: `${req.headers.origin}/thank-you.html?session_id={CHECKOUT_SESSION_ID}`,
    });
    return res.status(200).json({ clientSecret: session.client_secret });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
