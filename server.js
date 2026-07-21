// server.js — recibe leads de Facebook Ads y WhatsApp automáticamente
// y los guarda en Postgres para que el CRM los lea solos.
//
// Cubre DOS tipos de anuncios distintos (revisa el README para saber cuál usas):
//   A) Anuncios "clic a WhatsApp" (Click-to-WhatsApp Ads)
//      -> el cliente escribe directo a tu WhatsApp Business -> llega por el webhook de WhatsApp
//   B) Formularios instantáneos de Facebook (Lead Ads / "Generación de clientes potenciales")
//      -> el cliente llena un formulario dentro de Facebook -> llega por el webhook de leadgen
//
// Requiere Node 18+ (usa fetch nativo).

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());

const {
  VERIFY_TOKEN,          // tú lo inventas, lo pones también en Meta al registrar el webhook
  PAGE_ACCESS_TOKEN,     // token de tu Página de Facebook, con permiso leads_retrieval (para Lead Ads)
  WHATSAPP_TOKEN,        // token de acceso de WhatsApp Cloud API (puede ser el mismo que el de la app)
  CRM_API_KEY,           // clave que tú inventas; el CRM la usa para leer /api/leads
  DATABASE_URL,          // cadena de conexión de Postgres (Supabase, Render, etc.)
  PORT,
} = process.env;

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL && DATABASE_URL.includes('supabase') ? { rejectUnauthorized: false } : undefined,
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS leads (
      id SERIAL PRIMARY KEY,
      external_id TEXT UNIQUE,
      name TEXT,
      phone TEXT,
      source TEXT,
      interest TEXT,
      notes TEXT,
      raw_payload JSONB,
      created_at TIMESTAMPTZ DEFAULT now(),
      synced BOOLEAN DEFAULT false
    );
  `);
}

function requireApiKey(req, res, next) {
  const key = req.header('x-api-key');
  if (!CRM_API_KEY || key !== CRM_API_KEY) {
    return res.status(401).json({ error: 'API key inválida o faltante' });
  }
  next();
}

async function saveLead({ external_id, name, phone, source, interest, notes, raw_payload }) {
  try {
    await pool.query(
      `INSERT INTO leads (external_id, name, phone, source, interest, notes, raw_payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (external_id) DO NOTHING`,
      [external_id, name || '', phone || '', source || '', interest || '', notes || '', raw_payload || {}]
    );
  } catch (e) {
    console.error('Error guardando lead:', e.message);
  }
}

// ---------- Verificación del webhook (Meta la llama una sola vez al registrarlo) ----------
app.get('/webhook/meta', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// ---------- Webhook combinado: WhatsApp + Lead Ads ----------
app.post('/webhook/meta', async (req, res) => {
  res.sendStatus(200); // responde rápido, Meta reintenta si tardas
  try {
    const entries = req.body.entry || [];
    for (const entry of entries) {
      for (const change of entry.changes || []) {
        const field = change.field;
        const value = change.value || {};

        // A) Mensaje entrante de WhatsApp (clic a WhatsApp o cliente escribiendo directo)
        if (value.messages && value.messages[0]) {
          const msg = value.messages[0];
          const contact = (value.contacts && value.contacts[0]) || {};
          await saveLead({
            external_id: 'wa_' + msg.id,
            name: contact.profile ? contact.profile.name : '',
            phone: msg.from,
            source: 'WhatsApp Business',
            interest: msg.text ? msg.text.body : '',
            notes: msg.text ? msg.text.body : '',
            raw_payload: value,
          });
        }

        // B) Formulario instantáneo (Lead Ads)
        if (field === 'leadgen' && value.leadgen_id) {
          const leadDetails = await fetchLeadDetails(value.leadgen_id);
          if (leadDetails) {
            const fields = {};
            (leadDetails.field_data || []).forEach((f) => {
              fields[f.name] = (f.values && f.values[0]) || '';
            });
            await saveLead({
              external_id: 'fbleads_' + value.leadgen_id,
              name: fields.full_name || fields.name || '',
              phone: fields.phone_number || fields.phone || '',
              source: 'Facebook Ads',
              interest: fields.interes || fields.zona || '',
              notes: JSON.stringify(fields),
              raw_payload: leadDetails,
            });
          }
        }
      }
    }
  } catch (e) {
    console.error('Error procesando webhook:', e.message);
  }
});

async function fetchLeadDetails(leadgenId) {
  if (!PAGE_ACCESS_TOKEN) return null;
  const url = `https://graph.facebook.com/v20.0/${leadgenId}?access_token=${PAGE_ACCESS_TOKEN}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    console.error('Error consultando Graph API:', await resp.text());
    return null;
  }
  return resp.json();
}

// ---------- API que consume el CRM ----------
// El CRM llama esto cada cierto tiempo para traer leads nuevos.
app.get('/api/leads', requireApiKey, async (req, res) => {
  const since = req.query.since; // ISO date opcional
  const params = [];
  let query = 'SELECT * FROM leads';
  if (since) {
    params.push(since);
    query += ' WHERE created_at > $1';
  }
  query += ' ORDER BY created_at ASC LIMIT 200';
  const { rows } = await pool.query(query, params);
  res.json(rows);
});

app.get('/', (req, res) => res.send('CRM leads webhook activo.'));

const port = PORT || 3000;
initDb()
  .then(() => app.listen(port, () => console.log('Servidor escuchando en el puerto ' + port)))
  .catch((e) => {
    console.error('No se pudo inicializar la base de datos:', e.message);
    process.exit(1);
  });
