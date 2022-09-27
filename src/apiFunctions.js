import http from 'http';
import https from 'https';
import net from 'net';
import util from 'util';
import zlib from 'zlib';
import users from './users.js';

const needsPrivateHost = users.some((u) => u.type === 'private');

import { createLogger, format, transports } from 'winston';

const gunzipAsync = util.promisify(zlib.gunzip);
const { combine, timestamp, prettyPrint } = format;

const logger = createLogger({
  format: combine(
    timestamp(),
    prettyPrint(),
  ),
  transports: [new transports.File({ filename: 'api.log' })],
});

async function gz(data) {
  const buf = Buffer.from(data.slice(3), 'base64');
  const ret = await gunzipAsync(buf);
  return JSON.parse(ret.toString());
}

let privateHost;

function getPrivateHost() {
  const port = 21025;
  const hosts = [
    'localhost',
    'host.docker.internal',
    '172.17.0.1',
  ];
  for (let h = 0; h < hosts.length; h += 1) {
    const host = hosts[h];
    const sock = new net.Socket();
    sock.setTimeout(2500);
    // eslint-disable-next-line no-loop-func
    sock.on('connect', () => {
      sock.destroy();
      privateHost = host;
    })
      .on('error', () => {
        console.log('error', host);
        sock.destroy();
      })
      .on('timeout', () => {
        console.log('timeout', host);
        sock.destroy();
      })
      .connect(port, host);
  }
}
while (!privateHost && needsPrivateHost) {
  getPrivateHost();
  // eslint-disable-next-line
  await new Promise((resolve) => setTimeout(resolve, 60*1000));
  if (!privateHost) console.log('no private host found to make connection with!');
}

async function getHost(type) {
  if (type === 'mmo') return 'screeps.com';
  return privateHost;
}

async function getRequestOptions(info, path, method = 'GET', body = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(JSON.stringify(body)),
  };

  if (info.username) headers['X-Username'] = info.username;
  if (info.token) headers['X-Token'] = info.token;
  return {
    host: await getHost(info.type),
    port: info.type === 'mmo' ? 443 : 21025,
    path,
    method,
    headers,
    body,
    isHTTPS: info.type === 'mmo',
  };
}
async function req(options) {
  const reqBody = JSON.stringify(options.body);
  const { isHTTPS } = options;
  delete options.body;
  delete options.isHTTPS;

  const maxTime = new Promise((resolve) => {
    setTimeout(resolve, 10 * 1000, 'Timeout');
  });

  const executeReq = new Promise((resolve, reject) => {
    const request = (isHTTPS ? https : http).request(options, (res) => {
      res.setEncoding('utf8');
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        try {
          body = JSON.parse(body);
          resolve(body);
        } catch {
          resolve(body);
        }
      });
    });
    request.write(reqBody);
    request.on('error', (err) => {
      reject(err);
    });
    request.end();
  });

  return Promise.race([executeReq, maxTime])
    .then((result) => {
      if (result === 'Timeout') {
        logger.log('info', 'Timeout hit!', new Date(), JSON.stringify(options), reqBody);
        return;
      }
      // is result string
      if (typeof result === 'string' && result.startsWith('Rate limit exceeded')) logger.log('error', { data: result, options });
      else logger.log('info', { data: `${JSON.stringify(result).length / 1000} MB`, options });
      // eslint-disable-next-line consistent-return
      return result;
    })
    .catch((result) => {
      logger.log('error', { data: result, options });
      return result;
    });
}

export default class {
  static async getPrivateServerToken(username, password) {
    const options = await getRequestOptions({ type: 'private', username }, '/api/auth/signin', 'POST', {
      email: username,
      password,
    });
    const res = await req(options);
    if (!res) return undefined;
    return res.token;
  }

  static async getMemory(info, shard, statsPath = 'stats') {
    const options = await getRequestOptions(info, `/api/user/memory?path=${statsPath}&shard=${shard}`, 'GET');
    const res = await req(options);
    if (!res) return undefined;
    const data = await gz(res.data);
    return data;
  }

  static async getUserinfo(info) {
    const options = await getRequestOptions(info, '/api/auth/me', 'GET');
    const res = await req(options);
    return res;
  }

  static async getLeaderboard(info) {
    const options = await getRequestOptions(info, `/api/leaderboard/find?username=${info.username}&mode=world`, 'GET');
    const res = await req(options);
    return res;
  }

  static async getUsers() {
    const options = await getRequestOptions({}, '/api/stats/users', 'GET');
    const res = await req(options);
    return res;
  }

  static async getRoomsObjects() {
    const options = await getRequestOptions({}, '/api/stats/rooms/objects', 'GET');
    const res = await req(options);
    return res;
  }
}
