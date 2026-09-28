# Activación en Supabase y Vercel

## 1. Supabase

1. Crear un proyecto dedicado. Guardar su URL, clave pública anon/publishable y clave privada service_role/secret.
2. En SQL Editor, ejecutar `supabase/001_initial.sql` **una sola vez en una base nueva**. El script crea las tablas, planes Inicial/Profesional/Empresa, políticas RLS y funciones. Si ya hay datos, no volver a ejecutarlo: preparar una migración incremental.
3. En Authentication, habilitar Email y mantener la confirmación de correo. Establecer contraseña mínima de 12 caracteres también en Supabase; el formulario no sustituye la política del servidor.
4. Configurar SMTP propio para confirmación y recuperación dirigidas a clientes. El SMTP predeterminado no es un servicio de producción y restringe destinatarios: [Supabase SMTP](https://supabase.com/docs/guides/auth/auth-smtp).
5. Configurar `Site URL` con el dominio final de Vercel. Agregar exactamente el origen final y `https://TU-DOMINIO/?recovery=1` a Redirect URLs. Para desarrollo agregar `http://127.0.0.1:3100` y `http://127.0.0.1:3100/?recovery=1` si se usa ese puerto. Conservar `{{ .ConfirmationURL }}` en las plantillas de correo. [Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).
6. Configurar límites de Auth y protección contra registros abusivos adecuados al proyecto. El límite de 10 negocios por cuenta se valida en PostgreSQL.

## 2. Variables

Copiar `.env.example` a `.env.local` para desarrollo y establecer las mismas variables en Vercel > Settings > Environment Variables, en el entorno correcto.

| Variable | Uso | Visible en navegador |
|---|---|---|
| NEXT_PUBLIC_SUPABASE_URL | URL del proyecto Supabase | Sí |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | Clave pública anon o publishable | Sí, protegida por RLS |
| SUPABASE_SERVICE_ROLE_KEY | Clave privada service_role o secret | No |
| ENCRYPTION_KEY | 64 caracteres hexadecimales aleatorios | No |
| META_APP_SECRET | App Secret de la app de Meta que firma los eventos | No |
| META_VERIFY_TOKEN | Cadena aleatoria elegida para verificar el webhook | No |
| META_GRAPH_VERSION | Versión vigente configurada en tu app, p. ej. v23.0 | No |

Generar **dos valores independientes**, uno para cifrado y otro para verificación, con:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Guardar las claves en el gestor de secretos del despliegue. No enviarlas por chat ni ponerlas en variables `NEXT_PUBLIC_`. Respaldar ENCRYPTION_KEY en un lugar privado: cambiarla deja ilegibles los tokens existentes hasta reconectar los negocios.

## 3. Vercel

- Importar este proyecto desde un repositorio privado, o desplegar con la CLI oficial de Vercel desde esta carpeta.
- Framework: Next.js. Instalar con `npm ci`, compilar con `npm run build`. Elegir un runtime compatible con Node.js 22 o superior.
- Establecer las variables antes de compilar. Las variables `NEXT_PUBLIC_` se incorporan al build: modificarlas requiere redesplegar.
- Publicar en el dominio que se configuró en Supabase.
- Usar proyectos Supabase independientes para preview y producción, para que las pruebas no modifiquen datos reales.
- Configurar la disponibilidad pública de `/api/webhooks/meta` en el despliegue productivo: Meta debe acceder a esa ruta sin iniciar sesión en Vercel. La ruta valida la firma de Meta.

Flujo opcional con CLI, después de instalarla desde npm y autenticarte en tu cuenta:

```sh
npx vercel login
npx vercel link
npx vercel env pull .env.local
npm test
npx vercel deploy --prod
```

La CLI solicita la cuenta/proyecto y la configuración necesaria. No incluye credenciales en los comandos. [Documentación oficial](https://vercel.com/docs/projects/deploy-from-cli).

`/api/health` muestra si las variables están presentes; **no** comprueba conectividad, aplicación del SQL o permisos de Meta. La aceptación funcional se realiza abajo.

## 4. Primer administrador

1. Registrarse desde la aplicación y confirmar el correo.
2. En el SQL Editor privado de Supabase, ejecutar, sustituyendo el correo:

```sql
insert into public.platform_admins(user_id)
select id from auth.users where lower(email)=lower('TU-CORREO-ADMIN')
on conflict do nothing;
```

Comprobar que se insertó el usuario esperado. Nadie obtiene este rol automáticamente al registrarse. El propietario de un negocio no equivale al administrador de la plataforma. Actualizar el panel para mostrar Administración y Gestionar planes.

## 5. WhatsApp / Meta

La integración implementada es manual, para cuentas y números que puedes administrar en la app configurada.

1. Preparar WhatsApp Cloud API en la app de Meta y un número registrado. Para clientes externos, completar las verificaciones, permisos/revisión y requisitos de Meta correspondientes al modelo de negocio; no se incluyen ni sustituyen con código.
2. Configurar un token de usuario del sistema con acceso al WABA y permisos `whatsapp_business_management` y `whatsapp_business_messaging`. Los tokens temporales de prueba caducan.
3. Configurar el callback HTTPS `https://TU-DOMINIO/api/webhooks/meta` con el mismo Verify Token privado de Vercel.
4. Suscribir el campo `messages`. Verificar que la app esté suscrita a cada WABA correspondiente (`/{WABA_ID}/subscribed_apps`), según la configuración de Meta. Configurar el callback no sustituye la suscripción del WABA.
5. Desde el negocio, abrir WhatsApp > Conectar: Phone Number ID, WABA ID y token. El servidor consulta Meta para verificar que el número pertenece al WABA y cifra el token antes de guardarlo.
6. Desde un teléfono de prueba autorizado, escribir al número del negocio. Actualizar el panel y comprobar que el mensaje aparece solo en ese negocio.
7. Enviar una respuesta de texto dentro de la ventana de 24 horas. Comprobar los estados posteriores con Actualizar. Fuera de esa ventana usar una plantilla aprobada y su idioma exacto. La UI admite variables de texto del cuerpo, una por línea; no encabezados multimedia ni botones dinámicos.

La ruta POST verifica `x-hub-signature-256` sobre el cuerpo original antes de escribir; GET valida el Verify Token. No registra tokens ni cuerpos de mensajes en logs del servidor. Los datos de mensajes sí se conservan en la base de datos por diseño.

## 6. Verificación antes de entregar al cliente

- Registro con correo real, confirmación, entrada y recuperación de contraseña.
- Crear dos negocios y dos cuentas de cliente. Comprobar que cada una solo ve sus espacios y que el lector no puede modificar ni enviar.
- Agregar una cuenta ya registrada al equipo, cambiar su rol y quitarle el acceso. No se envían invitaciones de equipo automáticamente.
- Cambiar un plan y suspender/reactivar un negocio desde administración.
- Probar un cupo de usuarios y un límite de mensajes pequeños en un proyecto de prueba. No usar datos productivos para esta comprobación.
- Verificar recepción, envío, entrega y lectura real con el número autorizado de Meta.
- Comprobar un webhook duplicado y uno con firma inválida. Los reintentos no duplican mensajes.
- Revisar Runtime Logs de Vercel: los errores incluyen una referencia correlacionable y un código, sin secretos. Revisar también logs de Auth y PostgreSQL en Supabase.
- Configurar respaldo/retención de datos y responsable de atención al cliente. Los permisos de negocio y las cuotas están implementados; la operación del servicio requiere estas decisiones.

## 7. Posterior traslado a Hostinger

Conservar Supabase como servicio de base de datos y Auth. Trasladar solo Next.js:

- Hostinger debe disponer de Node.js administrado compatible o VPS; no subirlo como sitio HTML estático.
- Ruta Node.js: `npm ci`, `npm run build`, `npm start`. En VPS usar un servicio supervisado y proxy HTTPS.
- Ruta Docker: el `Dockerfile` genera una salida standalone, corre sin root y expone el puerto 3000. Las variables públicas son argumentos de compilación; las privadas se inyectan al ejecutar el contenedor.

```sh
docker build --build-arg NEXT_PUBLIC_SUPABASE_URL=https://TU-PROYECTO.supabase.co --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=TU-CLAVE-PUBLICA -t nexo .
docker run --env-file .env.local -p 127.0.0.1:3000:3000 --restart unless-stopped nexo
```

El build Docker se suministra para la migración; no se ha ejecutado en un VPS real. Al cambiar de dominio: actualizar URLs de Supabase y callback de Meta, conservar ENCRYPTION_KEY y verificar nuevamente autenticación y mensajes. No es necesario migrar tablas si se conserva el mismo proyecto Supabase.
