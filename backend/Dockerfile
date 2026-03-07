FROM python:3.11-slim

WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .
COPY migrations/ /migrations

EXPOSE 5000

CMD ["sh", "-c", "flask db upgrade && python seed.py && python app.py"]
