FROM python:3.11-slim

WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .
COPY migrations/ /migrations

ENV PYTHONPATH=/app
ENV FLASK_APP=app:create_app()

EXPOSE 5000

CMD ["sh", "-c", "flask db upgrade || echo 'Migration skipped'; python seed.py || echo 'Seed skipped'; exec gunicorn 'app:create_app()' --bind 0.0.0.0:${PORT:-5000} --timeout 120"]
