'use strict';

/* ═══════════════════════════════════════════════════════════════
   ANTIQUEVENTURE — server.js

   Environment variables to set in Railway:
     MONGO_URI        — MongoDB Atlas connection string
     ADMIN_PASSWORD   — your admin panel password
     SMTP_USER        — a throwaway Gmail address used only to send mail
     SMTP_PASS        — Gmail App Password for that account
                        Get one at: myaccount.google.com/apppasswords
═══════════════════════════════════════════════════════════════ */

const express    = require('express');
const session    = require('express-session');
const path       = require('path');
const nodemailer = require('nodemailer');
const { MongoClient } = require('mongodb');

const app  = express();
const PORT = process.env.PORT || 3000;

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'antiqueventure2025';
const MONGO_URI      = process.env.MONGO_URI      || '';
const SMTP_USER      = process.env.SMTP_USER      || '';
const SMTP_PASS      = process.env.SMTP_PASS      || '';

/* Your real inbox — never exposed publicly, only used server-side */
const OWNER_EMAIL = 'davidaudreygrey@gmail.com';

const PUBLIC_DIR = path.join(__dirname, 'public');

/* ── MongoDB ─────────────────────────────────────────────────── */
let db = null;
const memStore = { videos: [], updates: [], schedule: [] };

async function connectDB() {
  if (!MONGO_URI) {
    console.warn('No MONGO_URI set — data stored in memory (resets on restart).');
    return;
  }
  try {
    const client = new MongoClient(MONGO_URI);
    await client.connect();
    db = client.db('antiqueventure');
    console.log('MongoDB connected.');
  } catch (e) {
    console.error('MongoDB failed:', e.message);
  }
}

async function getAll(col) {
  if (db) return await db.collection(col).find({}, { projection: { _id: 0 } }).toArray();
  return memStore[col] || [];
}
async function insertDoc(col, doc) {
  if (db) await db.collection(col).insertOne({ ...doc });
  else { if (!memStore[col]) memStore[col] = []; memStore[col].unshift(doc); }
}
async function deleteDoc(col, id) {
  if (db) await db.collection(col).deleteOne({ id: Number(id) });
  else memStore[col] = (memStore[col] || []).filter(d => d.id != id);
}

/* ── Nodemailer ──────────────────────────────────────────────── */
function getTransporter() {
  if (!SMTP_USER || !SMTP_PASS) return null;
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
}

/* ── Middleware ──────────────────────────────────────────────── */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: 'av-' + ADMIN_PASSWORD,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));
app.use(express.static(PUBLIC_DIR));

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  res.status(401).json({ error: 'Unauthorised' });
}

/* ════════════════════════════════════════════════════════════════
   AUTH
════════════════════════════════════════════════════════════════ */
app.post('/api/login', (req, res) => {
  if (req.body.password === ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    res.json({ ok: true });
  } else {
    res.status(401).json({ error: 'Wrong password' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

app.get('/api/auth-status', (req, res) => {
  res.json({ admin: !!(req.session && req.session.isAdmin) });
});

/* ════════════════════════════════════════════════════════════════
   CONTACT FORM
   Sends anonymously from throwaway Gmail to your real inbox.
   Your real email is never visible to anyone visiting the site.
════════════════════════════════════════════════════════════════ */
app.post('/api/contact', async (req, res) => {
  const { name, subject, message } = req.body;
  if (!name || !subject || !message) {
    return res.status(400).json({ error: 'All fields required' });
  }
  if (message.length > 5000) {
    return res.status(400).json({ error: 'Message too long' });
  }

  const transporter = getTransporter();
  if (!transporter) {
    console.log('Contact (no email set up):', name, subject, message.substring(0, 80));
    return res.json({ ok: true });
  }

  try {
    await transporter.sendMail({
      from:    `"AntiqueVenture Site" <${SMTP_USER}>`,
      to:      OWNER_EMAIL,
      replyTo: SMTP_USER,
      subject: `[AV Contact] ${subject}`,
      text:    `New message from the AntiqueVenture website\n\nFrom: ${name}\nSubject: ${subject}\n\nMessage:\n${message}\n\n---\nSent via the contact form`
    });
    res.json({ ok: true });
  } catch (e) {
    console.error('Email error:', e.message);
    res.status(500).json({ error: 'Failed to send' });
  }
});

/* ════════════════════════════════════════════════════════════════
   VIDEOS
════════════════════════════════════════════════════════════════ */
app.get('/api/videos', async (req, res) => {
  try {
    const v = await getAll('videos');
    v.sort((a, b) => b.id - a.id);
    res.json(v);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/videos', requireAdmin, async (req, res) => {
  const { title, cat, dur, desc, glombleUrl, thumbnailUrl, videoId } = req.body;
  if (!title)      return res.status(400).json({ error: 'title required' });
  if (!glombleUrl) return res.status(400).json({ error: 'glombleUrl required' });
  const doc = {
    id: Date.now(), title: title.trim(), cat: cat || 'special',
    dur: dur || '0:00', desc: (desc||'').trim(),
    glombleUrl: glombleUrl.trim(), thumbnailUrl: (thumbnailUrl||'').trim(),
    videoId: (videoId||'').trim(), date: new Date().toISOString().slice(0,10)
  };
  try { await insertDoc('videos', doc); res.json(doc); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/videos/:id', requireAdmin, async (req, res) => {
  try { await deleteDoc('videos', req.params.id); res.json({ ok: true }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

/* ════════════════════════════════════════════════════════════════
   UPDATES
════════════════════════════════════════════════════════════════ */
app.get('/api/updates', async (req, res) => {
  try {
    const u = await getAll('updates');
    u.sort((a, b) => b.id - a.id);
    res.json(u);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/updates', requireAdmin, async (req, res) => {
  const { type, title, body } = req.body;
  if (!title || !body) return res.status(400).json({ error: 'title and body required' });
  const doc = {
    id: Date.now(), type: type||'news',
    title: title.trim(), body: body.trim(),
    date: new Date().toISOString().slice(0,10)
  };
  try { await insertDoc('updates', doc); res.json(doc); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/updates/:id', requireAdmin, async (req, res) => {
  try { await deleteDoc('updates', req.params.id); res.json({ ok: true }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

/* ════════════════════════════════════════════════════════════════
   SCHEDULE
════════════════════════════════════════════════════════════════ */
app.get('/api/schedule', async (req, res) => {
  try {
    const all = await getAll('schedule');
    const upcoming = all
      .filter(s => new Date(s.date) >= new Date(new Date().toDateString()))
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    res.json(upcoming);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/schedule', requireAdmin, async (req, res) => {
  const { title, type, date } = req.body;
  if (!title || !date) return res.status(400).json({ error: 'title and date required' });
  const doc = { id: Date.now(), title: title.trim(), type: (type||'').trim(), date };
  try { await insertDoc('schedule', doc); res.json(doc); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/schedule/:id', requireAdmin, async (req, res) => {
  try { await deleteDoc('schedule', req.params.id); res.json({ ok: true }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

/* ── Fallback ────────────────────────────────────────────────── */
app.get('*', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

/* ── Start ───────────────────────────────────────────────────── */
connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`AntiqueVenture running on port ${PORT}`);
    console.log(`DB: ${db ? 'MongoDB Atlas' : 'in-memory'}`);
    console.log(`Email: ${SMTP_USER || 'not configured'}`);
  });
});
