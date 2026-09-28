# Nexo · Plataforma SaaS modular

Aplicación Next.js con Supabase Auth y PostgreSQL. Demo interactiva en `/?demo=1`; operación real en `/`. El nombre Nexo es provisional.

## Qué está implementado

- Registro, confirmación por correo, acceso, recuperación y cambio de contraseña con Supabase Auth.
- Hasta 10 negocios creados por cuenta; datos aislados mediante RLS. Un usuario puede pertenecer a varios negocios.
- Propietario, administrador, agente y lector. Alta de integrantes por correo de una cuenta ya registrada, cambio de rol y revocación.
- Planes editables: usuarios, mensajes mensuales y disponibilidad de WhatsApp. Asignación manual y suspensión de cuentas.
- Panel del cliente, resumen mensual, últimos 200 mensajes, detalle de mensajes y actividad operativa.
- Panel global para cuentas y planes; el administrador puede abrir un negocio para gestionar su equipo y configuración.
- Conexión manual de WhatsApp Cloud API: validación de número y WABA, cifrado AES-256-GCM de tokens, webhook firmado, recepción de mensajes y estados, envío de texto y plantillas de texto.
- Controles transaccionales de cupos, límite de 30 envíos/minuto por negocio, idempotencia y protección de la ventana de 24 horas.
- Compilación para Vercel y salida Node.js standalone para un posterior servidor Hostinger.

## Estado de la entrega

El proyecto funciona localmente y puede compilarse sin credenciales para mostrar la demo. **La operación real requiere crear/configurar Supabase, aplicar el SQL, establecer las variables de Vercel y configurar Meta. No está publicado ni conectado a cuentas reales todavía.**

Pagos automáticos y asistente ChatGPT son módulos adicionales fuera de esta primera plataforma base. No hay checkout ni respuestas automáticas simuladas como reales.

## Desarrollo

Requiere Node.js 22 o superior y npm.

```sh
npm ci
npm run dev
```

Abrir `http://127.0.0.1:3000/?demo=1`. Si ese puerto ya está ocupado:

```sh
node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3100
```

Para compartir el panel demo con un prospecto, el acceso temporal es:

```text
Correo: demo@nexo.local
Contraseña: NexoDemo2026!
```

Acceso de cliente:

```text
Correo: cliente@nexo.local
Contraseña: ClienteDemo2026!
```

El demo de cliente queda limitado a `Estudio Oliva` y no muestra las secciones de administración de plataforma.

Ese usuario activa el modo demo local; no crea una cuenta en Supabase y todos los cambios son simulados. Para exponerlo temporalmente con Ngrok, mantén el servidor encendido y ejecuta en otra terminal:

```sh
ngrok http 3100
```

Comparte la URL HTTPS que muestre Ngrok y añade `/?demo=1` al final si quieres abrir directamente el demo. Usa un túnel temporal para prospectos y ciérralo con `Ctrl+C` al terminar. La contraseña es pública por diseño y no debe reutilizarse para clientes reales.

Para activar Supabase localmente, copiar `.env.example` a `.env.local` y completar las variables. No subir `.env.local` al repositorio. Reiniciar después de modificar variables públicas.

```sh
npm test
npm run build
npm start
```

## Publicar y activar

Seguir [docs/PUESTA_EN_MARCHA.md](docs/PUESTA_EN_MARCHA.md). Incluye SQL, administrador inicial, autenticación, Vercel, WhatsApp y criterios de entrega al cliente.

## Pruebas

`npm test` ejecuta PostgreSQL mediante PGlite, sin credenciales externas: aislamiento RLS entre negocios, prohibición de elevación a administrador, roles, límite de usuarios, cuotas de envío, suspensión, idempotencia de eventos, orden de entrega y cifrado/firma. PGlite ejecuta el SQL del proyecto; el esquema mínimo de `auth.users` de la prueba sustituye exclusivamente al servicio de identidad. No prueba la entrega de correos de Supabase ni las llamadas reales a Meta.

La suite de humo HTTP está en `tests/http-smoke.mjs` y requiere el servidor encendido:

```sh
node tests/http-smoke.mjs http://127.0.0.1:3100
```

## Límites explícitos

- La demo guarda sus cambios solo en memoria y nunca llama a Meta o a Supabase.
- Los mensajes se actualizan al pulsar Actualizar; no se mantiene una conexión realtime ni un proceso permanente.
- El panel muestra hasta 200 mensajes recientes. El historial completo permanece en PostgreSQL.
- Recepción de multimedia: se registra el tipo; no se descargan archivos. Envío: texto y plantillas con variables de texto en el cuerpo, sin encabezados multimedia ni botones dinámicos.
- Los tokens de Meta se introducen manualmente. Embedded Signup, revisión de la app y gestión automatizada de alta de clientes no forman parte de esta versión.
- Una sola app de Meta sirve los negocios; todos sus números deben estar suscritos a esa app. Para apps distintas por cliente, adaptar la selección de secretos del webhook.
- Los intentos reservados consumen cuota aunque fallen. Un timeout queda como `unknown`; un proceso interrumpido puede quedar `sending`. Nunca se reintenta un envío ambiguo automáticamente.
- La clave de cifrado debe conservarse al migrar. Si se pierde, los negocios tendrán que reconectar sus tokens.
- La confirmación de conexión indica que las credenciales fueron verificadas al guardarlas; no es un monitor continuo de validez de tokens.

## Estructura

`app/ui.js`: interfaz y formularios. `app/api/whatsapp`: conexión y envíos. `app/api/webhooks/meta`: eventos. `lib/security.mjs`: cifrado y firmas. `supabase/001_initial.sql`: tablas, RLS y operaciones transaccionales. `tests/`: comprobaciones ejecutables.
