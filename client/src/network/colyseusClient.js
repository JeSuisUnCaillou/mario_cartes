import Colyseus from 'colyseus.js';

const SERVER_URL = import.meta.env.PROD
  ? `${window.location.protocol.replace('http', 'ws')}//${window.location.host}`
  : 'ws://localhost:2567';

const client = new Colyseus.Client(SERVER_URL);

export async function joinAsBoard(gameUid) {
  const room = await client.joinOrCreate('game', { roomName: gameUid, clientType: 'board' });
  console.log('Joined as board:', room.sessionId);
  return room;
}

export async function joinAsPlayer(gameUid, playerName) {
  const room = await client.joinOrCreate('game', { roomName: gameUid, clientType: 'player', name: playerName });
  console.log('Joined as player:', room.sessionId);
  return room;
}
