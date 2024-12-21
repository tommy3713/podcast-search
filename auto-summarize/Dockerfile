# Use a base Python image
FROM python:3.10-slim

# Set the working directory
WORKDIR /app

# Copy project files
COPY . .

# Install dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Add environment variables (if needed)
ENV PYTHONUNBUFFERED=1

# Specify the command to run your script
CMD ["python", "/app/process_podcasts.py","production"]
