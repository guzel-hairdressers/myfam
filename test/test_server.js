/**
 * Automated test script for MyFam Server
 */

const http = require('http');
const { WebSocket } = require('ws');

// Import server
process.env.PORT = '3456';
require('../server.js');

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function testHttpEndpoint() {
  return new Promise((resolve, reject) => {
    http.get('http://localhost:3456/health', (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.status === 'ok') {
            console.log('✓ HTTP /health endpoint OK');
            resolve(true);
          } else {
            reject(new Error('Unexpected health response: ' + data));
          }
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function testStaticFile() {
  return new Promise((resolve, reject) => {
    http.get('http://localhost:3456/', (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200 && data.includes('MyFam')) {
          console.log('✓ Static index.html served OK');
          resolve(true);
        } else {
          reject(new Error('Static file check failed, status: ' + res.statusCode));
        }
      });
    }).on('error', reject);
  });
}

async function testWebSocketRoomAndSignaling() {
  return new Promise((resolve, reject) => {
    const ws1 = new WebSocket('ws://localhost:3456');
    const ws2 = new WebSocket('ws://localhost:3456');
    ws1.binaryType = 'arraybuffer';
    ws2.binaryType = 'arraybuffer';

    let ws1Joined = false;
    let ws2Joined = false;
    let binaryRelayVerified = false;

    ws1.on('open', () => {
      ws1.send(JSON.stringify({
        type: 'join',
        payload: { code: '742918', name: 'Alice', clientHash: 'test-hash-123' }
      }));
    });

    ws1.on('message', (data, isBinary) => {
      if (isBinary) {
        // ws1 received binary relay from ws2
        const view = new Uint8Array(data);
        if (view[0] === 0x01 && view[1] === 42) {
          binaryRelayVerified = true;
          console.log('✓ Stealth Binary Media Relay verified between peers');
          ws1.close();
          ws2.close();
          resolve(true);
        }
        return;
      }

      const msg = JSON.parse(data.toString());
      if (msg.type === 'joined') {
        ws1Joined = true;
        // Now open ws2 and join the same code
        ws2.send(JSON.stringify({
          type: 'join',
          payload: { code: '742918', name: 'Bob', clientHash: 'test-hash-123' }
        }));
      } else if (msg.type === 'peer-joined') {
        console.log('✓ Peer join notification received by Client 1');
      }
    });

    ws2.on('message', (data, isBinary) => {
      if (!isBinary) {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'joined') {
          ws2Joined = true;
          console.log('✓ Both peers joined code 742-918 successfully');
          // Test binary stealth packet from ws2 to ws1
          const testBinary = new Uint8Array([0x01, 42]);
          ws2.send(testBinary);
        }
      }
    });

    ws1.on('error', reject);
    ws2.on('error', reject);

    setTimeout(() => {
      if (!binaryRelayVerified) {
        reject(new Error('Signaling and binary test timed out'));
      }
    }, 5000);
  });
}

async function runAllTests() {
  console.log('Starting MyFam test suite...');
  await wait(500);
  await testHttpEndpoint();
  await testStaticFile();
  await testWebSocketRoomAndSignaling();
  console.log('All tests passed successfully!');
  process.exit(0);
}

runAllTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
