# Backend Dockerfile
FROM node:22
WORKDIR /usr/src/app
COPY . .
RUN npm install
COPY . .
EXPOSE 3000
CMD ["node", "./src/app.js"]
