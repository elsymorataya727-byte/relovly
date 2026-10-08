/* ============================================
   relovly — Telegram notification backend
   Receives form submissions from relovly pages
   and forwards them to your Telegram bot.

   Endpoints:
     POST /contact   → Contact Seller form
     POST /offer     → Make Offer form
     POST /shipping  → Request Shipping Quote form
     GET  /health    → uptime check
     GET  /          → basic info

   Env vars (set on Railway):
     TELEGRAM_BOT_TOKEN  — bot token from @BotFather
     TELEGRAM_CHAT_ID    — your chat/user id
     ALLOWED_ORIGINS     — comma-separated list of allowed sites
                           (leave empty during testing to allow all)
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
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

if (!BOT_TOKEN || !CHAT_ID) {
  console.error('❌ Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID env vars')
}

// ============================================
// CORS
// ============================================
app.use(cors({
  origin: function (origin, cb) {
    // allow requests with no origin (curl, health checks, server-to-server)
    if (!origin) return cb(null, true)
    // if ALLOWED_ORIGINS is empty, allow all (useful during testing)
    if (ALLOWED_ORIGINS.length === 0) return cb(null, true)
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true)
    return cb(new Error('Not allowed by CORS'))
  }
}))

// ============================================
// HELPERS
// ============================================
function esc(s) {
  if (s === null || s === undefined) return ''
  return String(s)
}

function htmlEsc(s) {
  return esc(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

async function sendToTelegram(text) {
  if (!BOT_TOKEN || !CHAT_ID) {
    throw new Error('Telegram not configured (missing env vars)')
  }
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text: text,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    })
  })
  const data = await res.json()
  if (!data.ok) {
    console.error('Telegram API error:', data)
    throw new Error(data.description || 'Telegram send failed')
  }
  return data
}

function nowStr() {
  return new Date().toLocaleString('en-GB', {
    timeZone: 'Europe/London',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  })
}

// ============================================
// HEALTH / INFO
// ============================================
app.get('/', (req, res) => {
  res.json({
    ok: true,
    service: 'relovly-telegram-bot',
    telegramConfigured: !!(BOT_TOKEN && CHAT_ID)
  })
})

app.get('/health', (req, res) => {
  res.json({ ok: true, timestamp: Date.now() })
})

// ============================================
// POST /contact  — Contact Seller form
// ============================================
app.post('/contact', async (req, res) => {
  try {
    const {
      name, email, phone, subject, message,
      listing_id, listing_title, listing_url
    } = req.body || {}

    if (!subject || !message) {
      return res.status(400).json({ ok: false, error: 'Missing subject or message' })
    }

    const lines = [
      '🟠 <b>New contact message</b>',
      '',
      `<b>From:</b> ${htmlEsc(name) || '—'}`,
      `<b>Email:</b> ${htmlEsc(email) || '—'}`,
      `<b>Phone / WhatsApp:</b> ${htmlEsc(phone) || '—'}`,
      '',
      `<b>Subject:</b> ${htmlEsc(subject)}`,
      `<b>Message:</b>`,
      `${htmlEsc(message)}`,
      ''
    ]

    if (listing_title) {
      lines.push(`<b>Item:</b> ${htmlEsc(listing_title)}`)
    }
    if (listing_url) {
      lines.push(`<b>Link:</b> ${htmlEsc(listing_url)}`)
    }
    if (listing_id) {
      lines.push(`<b>Listing ID:</b> ${htmlEsc(listing_id)}`)
    }

    lines.push('', `<i>${nowStr()}</i>`)

    await sendToTelegram(lines.join('\n'))
    return res.json({ ok: true })

  } catch (err) {
    console.error('POST /contact error:', err)
    return res.status(500).json({ ok: false, error: err.message })
  }
})

// ============================================
// POST /offer  — Make Offer form
// ============================================
app.post('/offer', async (req, res) => {
  try {
    const {
      amount, message,
      listing_id, listing_title, listing_url
    } = req.body || {}

    if (!amount) {
      return res.status(400).json({ ok: false, error: 'Missing amount' })
    }

    const lines = [
      '💸 <b>New offer</b>',
      '',
      `<b>Amount:</b> £${htmlEsc(amount)}`,
      ''
    ]

    if (message) {
      lines.push(`<b>Message:</b>`, htmlEsc(message), '')
    }
    if (listing_title) {
      lines.push(`<b>Item:</b> ${htmlEsc(listing_title)}`)
    }
    if (listing_url) {
      lines.push(`<b>Link:</b> ${htmlEsc(listing_url)}`)
    }
    if (listing_id) {
      lines.push(`<b>Listing ID:</b> ${htmlEsc(listing_id)}`)
    }

    lines.push('', `<i>${nowStr()}</i>`)

    await sendToTelegram(lines.join('\n'))
    return res.json({ ok: true })

  } catch (err) {
    console.error('POST /offer error:', err)
    return res.status(500).json({ ok: false, error: err.message })
  }
})

// ============================================
// POST /shipping  — Request Shipping Quote form
// ============================================
app.post('/shipping', async (req, res) => {
  try {
    const {
      full_name, address_line, city, postcode, country, phone, note,
      listing_id, listing_title, listing_url
    } = req.body || {}

    if (!full_name || !address_line || !city || !postcode || !country) {
      return res.status(400).json({ ok: false, error: 'Missing required address fields' })
    }

    const lines = [
      '🚚 <b>New shipping quote request</b>',
      '',
      `<b>Name:</b> ${htmlEsc(full_name)}`,
      `<b>Address:</b>`,
      `${htmlEsc(address_line)}`,
      `${htmlEsc(city)}${postcode ? ', ' + htmlEsc(postcode) : ''}`,
      `${htmlEsc(country)}`,
      ''
    ]

    if (phone) lines.push(`<b>Phone:</b> ${htmlEsc(phone)}`)
    if (note) lines.push(`<b>Note:</b> ${htmlEsc(note)}`)

    if (listing_title) {
      lines.push('', `<b>Item:</b> ${htmlEsc(listing_title)}`)
    }
    if (listing_url) {
      lines.push(`<b>Link:</b> ${htmlEsc(listing_url)}`)
    }
    if (listing_id) {
      lines.push(`<b>Listing ID:</b> ${htmlEsc(listing_id)}`)
    }

    lines.push('', `<i>${nowStr()}</i>`)

    await sendToTelegram(lines.join('\n'))
    return res.json({ ok: true })

  } catch (err) {
    console.error('POST /shipping error:', err)
    return res.status(500).json({ ok: false, error: err.message })
  }
})

// ============================================
// 404 + ERROR HANDLERS
// ============================================
app.use((req, res) => {
  res.status(404).json({ ok: false, error: 'Not found' })
})

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err)
  res.status(500).json({ ok: false, error: err.message })
})

// ============================================
// START
// ============================================
const PORT = process.env.PORT || 5000
app.listen(PORT, () => {
  console.log(`✅ relovly-telegram-bot listening on port ${PORT}`)
  console.log(`   Telegram configured: ${!!(BOT_TOKEN && CHAT_ID)}`)
  console.log(`   Allowed origins: ${ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS.join(', ') : '(all)'}`)
})
