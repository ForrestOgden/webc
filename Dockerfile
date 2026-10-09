FROM node:22-alpine
WORKDIR /app
COPY package.json server.js ./
COPY public ./public
COPY scripts ./scripts
RUN mkdir -p /app/data && chown node:node /app/data
ENV NODE_ENV=production PORT=3000 REPORTS_FILE=/app/data/reports.jsonl
EXPOSE 3000
USER node
CMD ["node", "server.js"]
