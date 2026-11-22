# Guía de Despliegue Beta (Gratis: TiDB Cloud + Render)

Esta guía sube **Don Rutero** en modalidad gratuita con HTTPS automático, tus **27 rutas** y **280 paradas** actuales, sin exponer usuarios locales ni contraseñas.

---

## 1. Base de datos gratis permanente: TiDB Cloud (Starter)

1. Crea una cuenta en [TiDB Cloud](https://tidbcloud.com/) y crea un clúster **Serverless / Starter** (plan gratuito `Free`).
2. En **Networking / Connect**, anota tus datos de conexión:
   - Host (ej. `gateway01.us-west-2.prod.aws.tidbcloud.com`)
   - Puerto: `4000`
   - Usuario (ej. `<prefix>.root`)
   - Contraseña generada
3. Crea la base de datos e importa el respaldo limpio del catálogo:
   ```sql
   CREATE DATABASE IF NOT EXISTS ruta_bus_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   USE ruta_bus_db;
   ```
   Luego importa [`database/don_rutero_catalog_beta.sql`](database/don_rutero_catalog_beta.sql) (contiene la estructura vacía de `users` y todas tus rutas, coordenadas y paradas) usando **Import / SQL Editor** de TiDB Cloud o `mysql` CLI:
   ```bash
   mysql --host <HOST> --port 4000 --user <USER> -p --ssl-mode=VERIFY_IDENTITY -D ruta_bus_db < database/don_rutero_catalog_beta.sql
   ```

---

## 2. Backend + Frontend en Render (Plan Free)

1. Sube este proyecto a un repositorio en **GitHub** (el `.gitignore` ya bloquea archivos `.env` y compilados `target/`).
2. En [Render](https://render.com/), elige **New → Blueprint** (detecta [`render.yaml`](render.yaml) automáticamente) o **New → Web Service**:
   - **Root Directory:** `backend`
   - **Runtime:** `Docker`
   - **Instance Type:** `Free`
   - **Health Check Path:** `/api/routes`
3. Configura las **Environment Variables** en Render:
   - `SPRING_PROFILES_ACTIVE` = `prod`
   - `EXPOSE_DEMO_CODES` = `false`
   - `JPA_DDL_AUTO` = `validate`
   - `DB_URL` = `jdbc:mysql://<HOST>:4000/ruta_bus_db?sslMode=REQUIRED&useUnicode=true&characterEncoding=utf8&serverTimezone=UTC`
   - `DB_USERNAME` = `<USER_DE_TIDB>`
   - `DB_PASSWORD` = `<PASSWORD_DE_TIDB>`
   - `JWT_SECRET` = *(cadena aleatoria de al menos 32 caracteres)*
   - `ADMIN_DEFAULT_PASSWORD` = *(tu nueva contraseña segura para el usuario `admin` en producción)*
   - `CORS_ALLOWED_ORIGINS` = `https://<nombre-de-tu-app>.onrender.com`

---

## 3. Verificación rápida tras el despliegue

- Entra a `https://<tu-app>.onrender.com` desde un celular y prueba:
  - Carga de las **27 rutas** y mapa OpenStreetMap.
  - Botón **Mi ubicación** y planificador **"¿Cómo llego?"**.
  - Acceso a `/admin.html` usando usuario `admin` y la clave que pusiste en `ADMIN_DEFAULT_PASSWORD`.
- *(Recuerda que en Render Free el servicio entra en reposo tras 15 minutos sin visitas; la primera petición puede tardar ~30–50 segundos en despertar).*
