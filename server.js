'use strict';

/* ═══════════════════════════════════════════════════════════════
   ANTIQUEVENTURE — server.js

   Environment variables to set in Railway:
     SUPABASE_URL     — your Supabase project URL
     SUPABASE_KEY     — your Supabase service role (secret) key
     ADMIN_PASSWORD   — your admin panel password
     SMTP_USER        — a throwaway Gmail address used only to send mail
     SMTP_PASS        — Gmail App Password for that account
                        Get one at: myaccount.google.com/apppasswords
═══════════════════════════════════════════════════════════════ */

const express    = require('express');
const session    = require('express-session');
const path       = require('path');
const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');

const app  = express();
const PORT = process.env.PORT || 3000;

const ADMIN_PASSWORD  = process.env.ADMIN_PASSWORD  || 'antiqueET26';
const SUPABASE_URL    = process.env.SUPABASE_URL    || '';
const SUPABASE_KEY    = process.env.SUPABASE_KEY    || '';
const SMTP_USER       = process.env.SMTP_USER       || '';
const SMTP_PASS       = process.env.SMTP_PASS       || '';

/* Your real inbox — never exposed publicly, only used server-side */
const OWNER_EMAIL = 'davidaudreygrey@gmail.com';

const PUBLIC_DIR = path.join(__dirname, 'public');

/* ── Supabase ────────────────────────────────────────────────── */
let supabase = null;

function connectDB() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.warn('No SUPABASE_URL/SUPABASE_KEY set — Supabase not connected.');
    return;
  }
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  console.log('Supabase connected.');
}

async function getAll(table) {
  if (!supabase) return [];
  const { data, error } = await supabase.from(table).select('*');
  if (error) throw new Error(error.message);
  return data || [];
}

async function insertDoc(table, doc) {
  if (!supabase) throw new Error('Supabase not connected');
  const { error } = await supabase.from(table).insert(doc);
  if (error) throw new Error(error.message);
}

async function deleteDoc(table, id) {
  if (!supabase) throw new Error('Supabase not connected');
  const { error } = await supabase.from(table).delete().eq('id', Number(id));
  if (error) throw new Error(error.message);
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
    const { data, error } = await supabase
      .from('videos')
      .select('*')
      .order('id', { ascending: false });
    if (error) throw new Error(error.message);
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/videos', requireAdmin, async (req, res) => {
  const { title, cat, dur, desc, glombleUrl, thumbnailUrl, videoId } = req.body;
  if (!title)      return res.status(400).json({ error: 'title required' });
  if (!glombleUrl) return res.status(400).json({ error: 'glombleUrl required' });
  const doc = {
    id: Date.now(), title: title.trim(), cat: cat || 'special',
    dur: dur || '0:00', desc: (desc||'').trim(),
    glomble_url: glombleUrl.trim(), thumbnail_url: (thumbnailUrl||'').trim(),
    video_id: (videoId||'').trim(), date: new Date().toISOString().slice(0,10)
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
    const { data, error } = await supabase
      .from('updates')
      .select('*')
      .order('id', { ascending: false });
    if (error) throw new Error(error.message);
    res.json(data);
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

/* ── Toggle pin on an update ─────────────────── */
app.post('/api/updates/:id/pin', requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { data, error } = await supabase
      .from('updates')
      .select('pinned')
      .eq('id', id)
      .single();
    if (error) throw new Error(error.message);

    const { error: updateError } = await supabase
      .from('updates')
      .update({ pinned: !data.pinned })
      .eq('id', id);
    if (updateError) throw new Error(updateError.message);

    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

/* ════════════════════════════════════════════════════════════════
   SCHEDULE
════════════════════════════════════════════════════════════════ */
app.get('/api/schedule', async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from('schedule')
      .select('*')
      .gte('date', today)
      .order('date', { ascending: true });
    if (error) throw new Error(error.message);
    res.json(data);
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
connectDB();
app.listen(PORT, () => {
  console.log(`AntiqueVenture running on port ${PORT}`);
  console.log(`DB: ${supabase ? 'Supabase' : 'not connected'}`);
  console.log(`Email: ${SMTP_USER || 'not configured'}`);
});
