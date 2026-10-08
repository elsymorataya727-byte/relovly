/* ============================================
   relovly — Backend (Telegram + Paystack)
   Handles:
     - Contact / Offer / Shipping → Telegram
     - Paystack init + verify (card only, USD)
   ============================================ */

const express = require('express')
const cors = require('cors')

const app = express()
app.use(express.json({ limit: '64kb' }))

// ============================================
// CONFIG
// ============================================
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const CHAT_ID = process.env.TELEGRAM_CHAT_ID
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean)

if (!BOT_TOKEN || !CHAT_ID) console.error('❌ Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID')
if (!PAYSTACK_SECRET) console.error('❌ Missing PAYSTACK_SECRET_KEY')

// ============================================
// CORS
// ============================================
app.use(cors({
  origin: function (origin, cb) {
    if (!origin) return cb(null, true)
    if (ALLOWED_ORIGINS.length === 0) return cb(null, true)
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true)
    return cb(new Error('Not allowed by CORS'))
  }
}))

// ============================================
// HELPERS
// ============================================
const htmlEsc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

async function sendToTelegram(text) {
  if (!BOT_TOKEN || !CHAT_ID) throw new Error('Telegram not configured')
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    })
  })
  const data = await res.json()
  if (!data.ok) throw new Error(data.description || 'Telegram send failed')
  return data
}

function nowStr() {
  return new Date().toLocaleString('en-GB', {
    timeZone: 'Europe/London',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  })
}

async function paystackRequest(path, method = 'GET', body = null) {
  if (!PAYSTACK_SECRET) throw new Error('Paystack not configured')
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET}`,
      'Content-Type': 'application/json'
    }
  }
  if (body) opts.body = JSON.stringify(body)

  const res = await fetch(`https://api.paystack.co${path}`, opts)
  const data = await res.json()
  if (!data.status) throw new Error(data.message || 'Paystack error')
  return data
}

// ============================================
// HEALTH / INFO
// ============================================
app.get('/', (req, res) => {
  res.json({
    ok: true,
    service: 'relovly-backend',
    telegramConfigured: !!(BOT_TOKEN && CHAT_ID),
    paystackConfigured: !!PAYSTACK_SECRET
  })
})
app.get('/health', (req, res) => res.json({ ok: true, t: Date.now() }))

// ============================================
// TELEGRAM ENDPOINTS
// ============================================
app.post('/contact', async (req, res) => {
  try {
    const { name, email, phone, subject, message, listing_id, listing_title, listing_url } = req.body || {}
    if (!subject || !message) return res.status(400).json({ ok: false, error: 'Missing subject or message' })

    const lines = [
      '🟠 <b>New contact message</b>', '',
      `<b>From:</b> ${htmlEsc(name) || '—'}`,
      `<b>Email:</b> ${htmlEsc(email) || '—'}`,
      `<b>Phone / WhatsApp:</b> ${htmlEsc(phone) || '—'}`, '',
      `<b>Subject:</b> ${htmlEsc(subject)}`,
      `<b>Message:</b>`, htmlEsc(message), ''
    ]
    if (listing_title) lines.push(`<b>Item:</b> ${htmlEsc(listing_title)}`)
    if (listing_url) lines.push(`<b>Link:</b> ${htmlEsc(listing_url)}`)
    if (listing_id) lines.push(`<b>Listing ID:</b> ${htmlEsc(listing_id)}`)
    lines.push('', `<i>${nowStr()}</i>`)

    await sendToTelegram(lines.join('\n'))
    res.json({ ok: true })
  } catch (err) {
    console.error('POST /contact error:', err)
    res.status(500).json({ ok: false, error: err.message })
  }
})

app.post('/offer', async (req, res) => {
  try {
    const { amount, message, listing_id, listing_title, listing_url } = req.body || {}
    if (!amount) return res.status(400).json({ ok: false, error: 'Missing amount' })

    const lines = ['💸 <b>New offer</b>', '', `<b>Amount:</b> $${htmlEsc(amount)}`, '']
    if (message) lines.push(`<b>Message:</b>`, htmlEsc(message), '')
    if (listing_title) lines.push(`<b>Item:</b> ${htmlEsc(listing_title)}`)
    if (listing_url) lines.push(`<b>Link:</b> ${htmlEsc(listing_url)}`)
    if (listing_id) lines.push(`<b>Listing ID:</b> ${htmlEsc(listing_id)}`)
    lines.push('', `<i>${nowStr()}</i>`)

    await sendToTelegram(lines.join('\n'))
    res.json({ ok: true })
  } catch (err) {
    console.error('POST /offer error:', err)
    res.status(500).json({ ok: false, error: err.message })
  }
})

app.post('/shipping', async (req, res) => {
  try {
    const { full_name, address_line, city, postcode, country, phone, note, listing_id, listing_title, listing_url } = req.body || {}
    if (!full_name || !address_line || !city || !postcode || !country) {
      return res.status(400).json({ ok: false, error: 'Missing required address fields' })
    }

    const lines = [
      '🚚 <b>New shipping quote request</b>', '',
      `<b>Name:</b> ${htmlEsc(full_name)}`,
      `<b>Address:</b>`, htmlEsc(address_line),
      `${htmlEsc(city)}${postcode ? ', ' + htmlEsc(postcode) : ''}`,
      htmlEsc(country), ''
    ]
    if (phone) lines.push(`<b>Phone:</b> ${htmlEsc(phone)}`)
    if (note) lines.push(`<b>Note:</b> ${htmlEsc(note)}`)
    if (listing_title) lines.push('', `<b>Item:</b> ${htmlEsc(listing_title)}`)
    if (listing_url) lines.push(`<b>Link:</b> ${htmlEsc(listing_url)}`)
    if (listing_id) lines.push(`<b>Listing ID:</b> ${htmlEsc(listing_id)}`)
    lines.push('', `<i>${nowStr()}</i>`)

    await sendToTelegram(lines.join('\n'))
    res.json({ ok: true })
  } catch (err) {
    console.error('POST /shipping error:', err)
    res.status(500).json({ ok: false, error: err.message })
  }
})

// ============================================
// PAYSTACK — INIT
// Body: { email, amount_usd, items: [{id, title, qty, price}], buyer_id }
// Returns: { ok, access_code, reference }
// ============================================
app.post('/paystack/init', async (req, res) => {
  try {
    const { email, amount_usd, items, buyer_id } = req.body || {}

    if (!email || !email.includes('@')) return res.status(400).json({ ok: false, error: 'Invalid email' })
    if (!amount_usd || amount_usd <= 0) return res.status(400).json({ ok: false, error: 'Invalid amount' })

    // Paystack expects the smallest unit (cents). USD → multiply by 100.
    const amount_cents = Math.round(parseFloat(amount_usd) * 100)

    const reference = 'RLV-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8).toUpperCase()

    const data = await paystackRequest('/transaction/initialize', 'POST', {
      email,
      amount: amount_cents,
      currency: 'USD',
      reference,
      metadata: {
        buyer_id: buyer_id || null,
        items: items || [],
        source: 'relovly'
      }
    })

    res.json({
      ok: true,
      access_code: data.data.access_code,
      reference: data.data.reference,
      authorization_url: data.data.authorization_url
    })
  } catch (err) {
    console.error('POST /paystack/init error:', err)
    res.status(500).json({ ok: false, error: err.message })
  }
})

// ============================================
// PAYSTACK — VERIFY
// Body: { reference }
// Returns: { ok, status, amount, currency, paid_at, customer }
// ============================================
app.post('/paystack/verify', async (req, res) => {
  try {
    const { reference } = req.body || {}
    if (!reference) return res.status(400).json({ ok: false, error: 'Missing reference' })

    const data = await paystackRequest(`/transaction/verify/${encodeURIComponent(reference)}`)

    // Fire-and-forget Telegram notification
    try {
      const d = data.data
      const lines = [
        '✅ <b>New paid order</b>', '',
        `<b>Reference:</b> ${htmlEsc(d.reference)}`,
        `<b>Amount:</b> $${(d.amount / 100).toFixed(2)} ${htmlEsc(d.currency)}`,
        `<b>Email:</b> ${htmlEsc(d.customer?.email || '—')}`,
        `<b>Paid at:</b> ${htmlEsc(d.paid_at || '—')}`,
        '', `<i>${nowStr()}</i>`
      ]
      await sendToTelegram(lines.join('\n'))
    } catch (e) {
      console.warn('Telegram notify on verify failed:', e.message)
    }

    res.json({
      ok: true,
      status: data.data.status,
      reference: data.data.reference,
      amount: data.data.amount,
      currency: data.data.currency,
      paid_at: data.data.paid_at,
      customer: data.data.customer,
      metadata: data.data.metadata
    })
  } catch (err) {
    console.error('POST /paystack/verify error:', err)
    res.status(500).json({ ok: false, error: err.message })
  }
})

// ============================================
// 404 + ERROR
// ============================================
app.use((req, res) => res.status(404).json({ ok: false, error: 'Not found' }))
app.use((err, req, res, next) => {
  console.error('Unhandled:', err)
  res.status(500).json({ ok: false, error: err.message })
})

// ============================================
// START
// ============================================
const PORT = process.env.PORT || 5000
app.listen(PORT, () => {
  console.log(`✅ relovly-backend listening on :${PORT}`)
  console.log(`   Telegram: ${!!(BOT_TOKEN && CHAT_ID)}`)
  console.log(`   Paystack: ${!!PAYSTACK_SECRET}`)
})
