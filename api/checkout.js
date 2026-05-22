const stripe = require('stripe')('sk_test_51TZcUfRyb3PIbuNPhRma93GIt1cXh5ajCAf2vKwqo18CyFa7JX4fXAdULdpdpZZzwsalrmpHLhmpyfSdjsrG4Q5G00WricrmuA');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { amount, productName, variant, ingredients } = req.body;

  if (!amount || amount < 1) {
    return res.status(400).json({ error: 'Invalid amount' });
  }

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
          unit_amount: Math.round(amount * 100), // convert to cents
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${req.headers.origin}/thank-you.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.headers.origin}/product-line.html`,
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
