FROM python:3.12-slim

WORKDIR /app

# Install system dependencies if any are needed (e.g., for psycopg2)
RUN apt-get update && apt-get install -y libpq-dev gcc curl && rm -rf /var/lib/apt/lists/*

# Copy requirements
COPY requirements.txt ./Brain/
RUN pip install --no-cache-dir -r ./Brain/requirements.txt

# Copy the rest of the application
COPY . ./Brain/

# Expose the port
EXPOSE 8001

# Run the application
CMD ["uvicorn", "Brain.main:app", "--host", "0.0.0.0", "--port", "8001"]
