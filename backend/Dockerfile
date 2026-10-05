# The API image. Built by Render from the repository; nothing here depends on
# a developer's machine.
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /srv

# Dependencies first: editing application code then costs nothing to reinstall.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY db ./db

# Render injects PORT. The fallback matches the local default so the image
# behaves the same when run by hand.
ENV PORT=4000
EXPOSE 4000

# Migrations run at boot. They are checksummed and hold an advisory lock, so a
# restart, a redeploy, or two containers starting together are all harmless.
CMD ["sh", "-c", "python -m db.migrate && exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
