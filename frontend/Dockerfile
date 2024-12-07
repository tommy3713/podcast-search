
# frontend/Dockerfile
# Use the Node.js 22 image as the base
FROM node:22
# Set working directory inside the container
WORKDIR /usr/src/app
# Copy package.json and package-lock.json files
COPY package*.json ./
# Install dependencies
RUN npm install
# Copy the rest of the frontend source code
COPY . .
# Expose the port your app runs on
EXPOSE 3001
# Define the command to run your application
CMD ["npm", "run", "dev"]
