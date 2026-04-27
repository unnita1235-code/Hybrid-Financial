FROM python:3.11-slim

WORKDIR /app

COPY requirements-local.txt .
RUN pip install --no-cache-dir -r requirements-local.txt

COPY packages/ packages/
COPY apps/server/ .

RUN pip install -e packages/database -e packages/ai-core -e .

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
