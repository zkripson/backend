/**
 * MegaETH Integration Utilities
 *
 * Functions for interacting with MegaETH smart contracts and Realtime API:
 * - WebSocket connections for realtime events
 * - Contract event monitoring
 * - Transaction helpers
 */

// Game contract ABI fragments for events
const GAME_EVENTS_ABI = [
	// ShotFired event
	'event ShotFired(address indexed player, uint8 x, uint8 y, uint256 indexed gameId)',

	// ShotResult event
	'event ShotResult(address indexed player, uint8 x, uint8 y, bool isHit, uint256 indexed gameId)',

	// GameCompleted event
	'event GameCompleted(address indexed winner, uint256 indexed gameId, uint256 endTime)',
];

// Topic hashes for the events
const EVENT_TOPICS = {
	ShotFired: '0x3a9e47588c8175a500eec33e983974e93aec6c02d5ac9985b9e88e27e7a9b3cb', // keccak256("ShotFired(address,uint8,uint8,uint256)")
	ShotResult: '0x9c5f5af1ca785633358f1aa606d964c927558ce3ce5e9e2e270c66c8a65fecd9', // keccak256("ShotResult(address,uint8,uint8,bool,uint256)")
	GameCompleted: '0xf168bbf52af41088f8a709042ec88261e309c3c9e7c0f7b66773c27c5da78c57', // keccak256("GameCompleted(address,uint256,uint256)")
};

/**
 * Monitor game events from a contract via MegaETH Realtime API
 *
 * @param rpcUrl The MegaETH Realtime WebSocket URL
 * @param contractAddress The game contract address to monitor
 * @param callback Function to call with event data
 * @returns WebSocket connection
 */
export function monitorGameEvents(rpcUrl: string, contractAddress: string, callback: (event: any) => void): WebSocket {
	// Connect to MegaETH Realtime API WebSocket
	const ws = new WebSocket(rpcUrl);

	// Connection established handler
	ws.addEventListener('open', () => {
		console.log(`WebSocket connection established to ${rpcUrl}`);

		// Subscribe to logs from the game contract
		ws.send(
			JSON.stringify({
				method: 'eth_subscribe',
				params: [
					'logs',
					{
						address: contractAddress,
						topics: [[EVENT_TOPICS.ShotFired, EVENT_TOPICS.ShotResult, EVENT_TOPICS.GameCompleted]],
					},
				],
				id: 1,
			})
		);
	});

	// Message handler
	ws.addEventListener('message', (event: any) => {
		try {
			const data = JSON.parse(event.data);

			// Check if it's a subscription result
			if (data.params && data.params.result) {
				const log = data.params.result;

				// Parse the event data based on the topic
				const parsedEvent = parseEventLog(log);
				if (parsedEvent) {
					callback(parsedEvent);
				}
			}
		} catch (error) {
			console.error('Error parsing WebSocket message:', error);
		}
	});

	// Error handler
	ws.addEventListener('error', (error) => {
		console.error('WebSocket error:', error);
	});

	// Reconnection handler
	ws.addEventListener('close', () => {
		console.log('WebSocket connection closed, attempting to reconnect...');

		// Reconnect after 2 seconds
		setTimeout(() => {
			monitorGameEvents(rpcUrl, contractAddress, callback);
		}, 2000);
	});

	return ws;
}

/**
 * Parse an event log from MegaETH into a structured event object
 *
 * @param log The raw event log from MegaETH
 * @returns Structured event object or null if not recognized
 */
function parseEventLog(log: any): any | null {
	// Determine event type from topic
	const eventTopic = log.topics[0];

	switch (eventTopic) {
		case EVENT_TOPICS.ShotFired:
			return parseShotFiredEvent(log);

		case EVENT_TOPICS.ShotResult:
			return parseShotResultEvent(log);

		case EVENT_TOPICS.GameCompleted:
			return parseGameCompletedEvent(log);

		default:
			return null;
	}
}

/**
 * Parse a ShotFired event log
 */
function parseShotFiredEvent(log: any): any {
	// Extract player address from indexed parameter
	const playerHex = log.topics[1];
	const player = '0x' + playerHex.slice(26);

	// Decode the data field (x, y coordinates)
	const data = log.data.slice(2); // remove 0x prefix

	// In Solidity, uint8 takes up a full 32 bytes in the ABI encoding
	const x = parseInt(data.slice(0, 64), 16);
	const y = parseInt(data.slice(64, 128), 16);

	// Extract gameId from indexed parameter
	const gameId = parseInt(log.topics[2], 16).toString();

	return {
		name: 'ShotFired',
		player,
		x,
		y,
		gameId,
		blockNumber: log.blockNumber,
		transactionHash: log.transactionHash,
		timestamp: Date.now(), // Note: Using client timestamp as MegaETH doesn't include it
	};
}

/**
 * Parse a ShotResult event log
 */
function parseShotResultEvent(log: any): any {
	// Extract player address from indexed parameter
	const playerHex = log.topics[1];
	const player = '0x' + playerHex.slice(26);

	// Decode the data field (x, y, isHit)
	const data = log.data.slice(2); // remove 0x prefix

	const x = parseInt(data.slice(0, 64), 16);
	const y = parseInt(data.slice(64, 128), 16);
	const isHit = parseInt(data.slice(128, 192), 16) === 1;

	// Extract gameId from indexed parameter
	const gameId = parseInt(log.topics[2], 16).toString();

	return {
		name: 'ShotResult',
		player,
		x,
		y,
		isHit,
		gameId,
		blockNumber: log.blockNumber,
		transactionHash: log.transactionHash,
		timestamp: Date.now(),
	};
}

/**
 * Parse a GameCompleted event log
 */
function parseGameCompletedEvent(log: any): any {
	// Extract winner address from indexed parameter
	const winnerHex = log.topics[1];
	const winner = '0x' + winnerHex.slice(26);

	// Extract gameId from indexed parameter
	const gameId = parseInt(log.topics[2], 16).toString();

	// Decode the data field (endTime)
	const data = log.data.slice(2); // remove 0x prefix
	const endTime = parseInt(data.slice(0, 64), 16) * 1000; // Convert to milliseconds

	return {
		name: 'GameCompleted',
		winner,
		gameId,
		endTime,
		blockNumber: log.blockNumber,
		transactionHash: log.transactionHash,
		timestamp: Date.now(),
	};
}

/**
 * Subscribe to state changes for a specific address
 *
 * @param rpcUrl The MegaETH Realtime WebSocket URL
 * @param address The address to monitor for state changes
 * @param callback Function to call with state change data
 * @returns WebSocket connection
 */
export function subscribeToStateChanges(rpcUrl: string, address: string, callback: (stateChange: any) => void): WebSocket {
	const ws = new WebSocket(rpcUrl);

	ws.addEventListener('open', () => {
		console.log(`State changes WebSocket connection established to ${rpcUrl}`);

		// Subscribe to state changes for the address
		ws.send(
			JSON.stringify({
				method: 'eth_subscribe',
				params: ['stateChange', [address]],
				id: 1,
			})
		);
	});

	ws.addEventListener('message', (event: any) => {
		try {
			const data = JSON.parse(event.data);

			// Check if it's a subscription result
			if (data.params && data.params.result) {
				const stateChange = data.params.result;
				callback(stateChange);
			}
		} catch (error) {
			console.error('Error parsing state change message:', error);
		}
	});

	// Error and reconnection handlers similar to monitorGameEvents
	ws.addEventListener('error', (error) => {
		console.error('State changes WebSocket error:', error);
	});

	ws.addEventListener('close', () => {
		console.log('State changes WebSocket connection closed, attempting to reconnect...');

		setTimeout(() => {
			subscribeToStateChanges(rpcUrl, address, callback);
		}, 2000);
	});

	return ws;
}

/**
 * Subscribe to mini-block fragments
 *
 * @param rpcUrl The MegaETH Realtime WebSocket URL
 * @param callback Function to call with mini-block fragment data
 * @returns WebSocket connection
 */
export function subscribeToMiniBlocks(rpcUrl: string, callback: (fragment: any) => void): WebSocket {
	const ws = new WebSocket(rpcUrl);

	ws.addEventListener('open', () => {
		console.log(`Mini-block WebSocket connection established to ${rpcUrl}`);

		// Subscribe to mini-block fragments
		ws.send(
			JSON.stringify({
				method: 'eth_subscribe',
				params: ['fragment'],
				id: 1,
			})
		);
	});

	ws.addEventListener('message', (event: any) => {
		try {
			const data = JSON.parse(event.data);

			// Check if it's a subscription result
			if (data.params && data.params.result) {
				const fragment = data.params.result;
				callback(fragment);
			}
		} catch (error) {
			console.error('Error parsing mini-block fragment message:', error);
		}
	});

	// Error and reconnection handlers
	ws.addEventListener('error', (error) => {
		console.error('Mini-block WebSocket error:', error);
	});

	ws.addEventListener('close', () => {
		console.log('Mini-block WebSocket connection closed, attempting to reconnect...');

		setTimeout(() => {
			subscribeToMiniBlocks(rpcUrl, callback);
		}, 2000);
	});

	return ws;
}
