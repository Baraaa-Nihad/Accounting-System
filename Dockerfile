# syntax=docker/dockerfile:1

# ============================================================
# النظام المالي للمدرسة — صورة إنتاج (Next.js standalone)
# ============================================================

FROM node:22-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# ---------- الاعتماديات (تشمل أدوات البناء والترحيل) ----------
FROM base AS deps
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
# رابط وهمي أثناء البناء فقط (prisma generate لا يتصل بالقاعدة)
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci

# ---------- البناء ----------
FROM deps AS builder
COPY . .
# مجلد public فارغ حاليًا فلا يتتبعه git؛ ننشئه لأن مرحلة التشغيل تنسخه
RUN mkdir -p public && npx prisma generate && npm run build

# ---------- الترحيل والبيانات الأساسية (خدمة تُشغَّل مرة عند كل تحديث) ----------
FROM builder AS migrate
CMD ["sh", "-c", "npx prisma migrate deploy && npx prisma db seed"]

# ---------- التشغيل ----------
FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    STORAGE_DIR=/data/storage \
    CHROMIUM_PATH=/usr/bin/chromium
# أدوات PostgreSQL 16 (للنسخ الاحتياطي والاستعادة) وChromium (لتوليد PDF)
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
 && install -d /usr/share/postgresql-common/pgdg \
 && curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc \
 && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client-16 chromium fonts-noto-core \
 && apt-get purge -y curl gnupg && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/*
# مجلد منزل قابل للكتابة: Chromium يكتب فيه إعداداته وملفات معالج الأعطال
RUN groupadd --system app && useradd --system --gid app --home-dir /home/app --create-home app \
 && mkdir -p /data/storage && chown -R app:app /data
COPY --from=builder --chown=app:app /app/.next/standalone ./
COPY --from=builder --chown=app:app /app/.next/static ./.next/static
COPY --from=builder --chown=app:app /app/public ./public
COPY --from=builder --chown=app:app /app/prisma ./prisma
USER app
EXPOSE 3000
VOLUME ["/data/storage"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
