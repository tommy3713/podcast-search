# Use a base Python image
FROM python:3.11-slim
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

# Set the working directory
WORKDIR /app

# Copy project files
COPY main.py requirements.txt config-prod.json ./

# Install dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Specify the command to run your script
CMD ["python", "main.py","production"]
