# Leads automáticos: Facebook Ads → WhatsApp → CRM

Este servidor recibe los leads automáticamente y los guarda en una base de datos real.
Tu CRM (el archivo .htm) los va a leer de ahí cada 45 segundos, solo, sin que tú hagas nada.

Antes de empezar, entiende que existen **dos tipos de anuncios distintos** en Facebook Ads,
y usan una conexión distinta:

| Tipo de anuncio | Cómo llega el lead | Qué necesitas |
|---|---|---|
| **Clic a WhatsApp** (el anuncio abre un chat de WhatsApp) | El cliente te escribe directo por WhatsApp | WhatsApp Business Platform (Cloud API) |
| **Formulario instantáneo / Lead Ads** (el cliente llena un formulario sin salir de Facebook) | Facebook te avisa por webhook | Permiso `leads_retrieval` sobre tu Página |

Puedes activar una, la otra, o ambas — el servidor ya las soporta las dos.

---

## Paso 1 — Base de datos (Supabase, gratis)

1. Entra a https://supabase.com y crea una cuenta (puedes usar tu GitHub).
2. Crea un proyecto nuevo. Elige una contraseña de base de datos y guárdala.
3. Cuando el proyecto esté listo: **Project Settings → Database → Connection string → URI**.
4. Copia esa cadena. Se ve así: `postgresql://postgres:TU_PASSWORD@db.xxxx.supabase.co:5432/postgres`
5. Guárdala, la vas a necesitar en el Paso 3.

## Paso 2 — Sube este código a GitHub

1. Crea un repositorio nuevo en GitHub (puede ser privado), por ejemplo `crm-leads-webhook`.
2. Sube estos 4 archivos que te di: `server.js`, `package.json`, `.env.example`, `README.md`.
   - Más fácil: en GitHub, botón "Add file → Upload files" y arrastra los 4 archivos.

## Paso 3 — Despliega el servidor en Render (gratis)

1. Entra a https://render.com y crea una cuenta con tu GitHub (así conecta directo).
2. Click **New → Web Service**.
3. Elige el repositorio que acabas de subir.
4. Configuración:
   - **Runtime:** Node
   - **Build command:** `npm install`
   - **Start command:** `npm start`
   - **Plan:** Free
5. En la sección **Environment**, agrega estas variables (los valores los inventas tú, excepto DATABASE_URL que es la del Paso 1):
   - `DATABASE_URL` → la cadena de Supabase del Paso 1
   - `VERIFY_TOKEN` → una frase secreta, ej. `inmobiliaria2026verify`
   - `CRM_API_KEY` → otra frase secreta distinta, ej. `inmobiliaria2026crmkey`
   - `PAGE_ACCESS_TOKEN` → lo dejas vacío por ahora, lo llenas en el Paso 4 o 5
   - `WHATSAPP_TOKEN` → lo dejas vacío por ahora
6. Click **Create Web Service** y espera a que despliegue (2-3 min).
7. Cuando termine, Render te da una URL pública, algo como:
   `https://crm-leads-webhook.onrender.com`
   Esa es tu URL de servidor. Guárdala.

   > Nota: en el plan gratis, Render "duerme" el servidor tras 15 min sin uso y tarda ~30s
   > en despertar con el siguiente lead. Para un negocio en producción real, el plan pagado
   > (~$7 USD/mes) evita ese retraso. Para probar y arrancar, el gratis funciona bien.

---

## Paso 4 — Conectar anuncios "Clic a WhatsApp" (WhatsApp Business Platform)

1. Ve a https://developers.facebook.com → **Mis apps → Crear app** → tipo "Empresa".
2. Dentro de la app, agrega el producto **WhatsApp**.
3. Meta te asigna un número de prueba (o conecta tu número real de WhatsApp Business).
4. En **WhatsApp → Configuración de API**, copia el **Token de acceso temporal** (o genera uno
   permanente en Configuración del sistema) y ponlo en Render como `WHATSAPP_TOKEN`.
5. En **WhatsApp → Configuración → Webhooks**, click **Editar**:
   - **URL de devolución de llamada:** `https://TU-URL-DE-RENDER.onrender.com/webhook/meta`
   - **Verify token:** el mismo que pusiste en `VERIFY_TOKEN`
6. Suscríbete al campo **messages**.
7. Ahora, cuando alguien te escriba por WhatsApp desde un anuncio "clic a WhatsApp", el lead
   se guarda solo.

## Paso 5 — Conectar formularios instantáneos (Lead Ads)

1. En la misma app de Meta for Developers, agrega el producto **Webhooks** (si no está ya).
2. Selecciona el objeto **Página** y suscríbete al campo **leadgen**.
3. Registra la misma URL: `https://TU-URL-DE-RENDER.onrender.com/webhook/meta` con el mismo `VERIFY_TOKEN`.
4. Necesitas un **token de acceso de Página** con permiso `leads_retrieval`:
   - Ve a **Herramientas → Explorador de la API Graph**, selecciona tu Página, genera un token
     con los permisos `pages_manage_ads`, `leads_retrieval`, `pages_read_engagement`.
   - Para producción (que no expire cada hora) necesitarás pasar por la revisión de la app de Meta
     (App Review) — es un trámite estándar de Meta, no algo que yo pueda saltarme por ti.
5. Pon ese token en Render como `PAGE_ACCESS_TOKEN`.
6. Vincula tu Página de Facebook con tu app en **Configuración de la app → Páginas**.
7. Ahora, cuando alguien llene un formulario instantáneo de tu campaña, el lead se guarda solo.

---

## Paso 6 — Conectar el CRM

1. Abre tu CRM (el archivo .htm).
2. Ve a **Integraciones**.
3. Pega ahí la URL de Render y la `CRM_API_KEY` que inventaste (te voy a agregar esos dos
   campos al CRM en el siguiente paso, aquí en el chat).
4. A partir de ahí, el CRM va a revisar cada 45 segundos si hay leads nuevos y los va a
   agregar solo a tu tablero, en la columna "Nuevo".

---

## ¿Y si algo no jala?

- Revisa los **Logs** de tu servicio en Render — ahí ves cada webhook que llega y cualquier error.
- Si Meta no logra verificar el webhook, casi siempre es porque el `VERIFY_TOKEN` no coincide
  exactamente entre Render y el formulario de Meta.
- Si los leads de formulario no traen teléfono, revisa los nombres de los campos configurados
  en tu formulario dentro de Meta Ads Manager — deben llamarse `phone_number` y `full_name`,
  o edita esos nombres en `server.js` (línea `fields.phone_number || fields.phone`).
