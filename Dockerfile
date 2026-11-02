FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 KCMS_DATA_DIR=/data PORT=8000
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN useradd --system --uid 1000 kcms && mkdir -p /data && chown kcms /data
USER kcms
VOLUME ["/data"]
EXPOSE 8000
CMD ["python", "app.py"]
