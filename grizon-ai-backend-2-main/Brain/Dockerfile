FROM python:3.12-slim

WORKDIR /app

# Install system dependencies and Node.js for npx esbuild validation
RUN apt-get update && apt-get install -y libpq-dev gcc curl ca-certificates && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs || \
    (echo "nodesource failed, trying direct download..." && \
     curl -fsSL https://nodejs.org/dist/v20.18.1/node-v20.18.1-linux-x64.tar.xz -o /tmp/node.tar.xz && \
     tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 && \
     rm /tmp/node.tar.xz) && \
    rm -rf /var/lib/apt/lists/*

# Copy requirements
COPY requirements.txt ./Brain/
RUN pip install --no-cache-dir -r ./Brain/requirements.txt

# Copy the rest of the application
COPY . ./Brain/

# Expose the port
EXPOSE 8001

# Run the application
CMD ["uvicorn", "Brain.main:app", "--host", "0.0.0.0", "--port", "8001"]
