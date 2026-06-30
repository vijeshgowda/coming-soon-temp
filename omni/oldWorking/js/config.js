/**
 * Project A — Client Configuration
 *
 * After deploying your signaling server to Render, update SIGNALING_URL below.
 * Get free TURN credentials at https://www.metered.ca/stun-turn
 * 
 */

export const CONFIG = {
  // Your Render signaling server WebSocket URL
  // After deploying, it will be: wss://project-a-signal.onrender.com
  SIGNALING_URL: 'wss://omni-8t2t.onrender.com',

  ICE_SERVERS: [
    // Free public STUN servers — no setup needed
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },

    // Metered.ca TURN relay — for the ~15% of connections behind strict NAT
    // Replace with your credentials from https://www.metered.ca/stun-turn
    {
      urls: 'turn:global.relay.metered.ca:80',
      username: '0cefb2fbcb33b85faa1dcbc2',
      credential: 'P3sNIoL2SmEjGV4Z',
    },
    {
      urls: 'turn:global.relay.metered.ca:443',
      username: '0cefb2fbcb33b85faa1dcbc2',
      credential: 'P3sNIoL2SmEjGV4Z',
    },
    {
      urls: 'turns:global.relay.metered.ca:443',
      username: '0cefb2fbcb33b85faa1dcbc2',
      credential: 'P3sNIoL2SmEjGV4Z',
    },
  ],
};
