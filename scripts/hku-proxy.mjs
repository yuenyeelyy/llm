#!/usr/bin/env node
/**
 * HKU API Proxy Server
 *
 * Workaround for workerd (Cloudflare Workers local dev) unable to reach api.hku.hk
 * This proxy runs on localhost:3001 and forwards requests to the real HKU API endpoint.
 *
 * Usage:
 *   node scripts/hku-proxy.mjs
 *
 * Then in .dev.vars, use:
 *   HKU_API_ENDPOINT=http://127.0.0.1:3001/openai/student/deployments/gpt-5-mini/chat/completions
 */

import http from 'http';
import { URL } from 'url';

const PROXY_PORT = 3001;
const HKU_API_BASE = 'https://api.hku.hk';

const server = http.createServer(async (req, res) => {
  // Set CORS headers to allow workerd requests
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, api-key');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Only POST requests are supported' }));
    return;
  }

  try {
    // Build the full HKU endpoint URL
    const pathAndQuery = req.url.startsWith('/') ? req.url : '/' + req.url;
    const fullUrl = HKU_API_BASE + pathAndQuery;

    console.log(`[HKU Proxy] ${req.method} ${pathAndQuery}`);
    console.log(`[HKU Proxy] Forwarding to: ${fullUrl}`);

    // Collect request body
    let body = '';
    for await (const chunk of req) {
      body += chunk.toString();
    }

    // Extract api-key from request headers
    const apiKey = req.headers['api-key'] || process.env.HKU_API_KEY;
    if (!apiKey) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing api-key header or HKU_API_KEY environment variable' }));
      return;
    }

    // Forward request to real HKU API
    const proxyRes = await fetch(fullUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey,
      },
      body: body,
    });

    // Forward response status and headers
    res.writeHead(proxyRes.status, {
      'Content-Type': proxyRes.headers.get('content-type') || 'application/json',
      'Access-Control-Allow-Origin': '*',
    });

    // Stream response body
    const responseBody = await proxyRes.text();
    res.end(responseBody);

    console.log(`[HKU Proxy] Response: ${proxyRes.status}`);
  } catch (error) {
    console.error('[HKU Proxy Error]', error.message);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Proxy forwarding failed',
      message: error.message,
    }));
  }
});

server.listen(PROXY_PORT, '127.0.0.1', () => {
  console.log(`\n🌉 HKU API Proxy listening on http://127.0.0.1:${PROXY_PORT}`);
  console.log(`📍 Forwarding to: ${HKU_API_BASE}`);
  console.log(`🔑 Using HKU_API_KEY from environment\n`);
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`\n❌ Port ${PROXY_PORT} is already in use`);
    console.error('   Kill existing process: lsof -ti:3001 | xargs kill -9');
  } else {
    console.error(`\n❌ Server error: ${error.message}`);
  }
  process.exit(1);
});

process.on('SIGINT', () => {
  console.log('\n👋 Proxy shutting down...');
  server.close(() => process.exit(0));
});
