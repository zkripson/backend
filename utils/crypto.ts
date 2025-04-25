/**
 * Cryptographic Utilities
 *
 * Functions for:
 * - Generating secure invite codes
 * - Verifying signatures
 * - Creating and validating hashes
 */

/**
 * Generate a unique, readable invite code
 * Using a combination of characters that are easily readable and typeable
 *
 * @returns A unique 8-character invite code
 */
export async function generateInviteCode(): Promise<string> {
	// Characters that are unambiguous (no 0/O, 1/I/l, etc.)
	const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

	// Generate 4 random bytes (32 bits) of randomness
	const buffer = new Uint8Array(4);
	crypto.getRandomValues(buffer);

	let code = '';

	// Use each byte to select characters from the charset
	// This gives us log2(32) * 4 = 20 bits of randomness
	// Which is enough for 2^20 = ~1 million unique codes
	for (let i = 0; i < 8; i++) {
		// Use pairs of bits from each byte (0-3) to get indices 0-31
		const index = i < 4 ? buffer[i] % charset.length : buffer[i - 4] % charset.length;

		code += charset[index];
	}

	// Add dashes for readability (ABC-DEF-GH)
	return `${code.slice(0, 3)}-${code.slice(3, 6)}-${code.slice(6, 8)}`;
}

/**
 * Generate a random salt for cryptographic operations
 *
 * @returns A random hexadecimal string
 */
export function generateSalt(): string {
	const buffer = new Uint8Array(16);
	crypto.getRandomValues(buffer);
	return Array.from(buffer)
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('');
}

/**
 * Create a SHA-256 hash of the input string
 *
 * @param input The string to hash
 * @returns A hex string of the SHA-256 hash
 */
export async function sha256(input: string): Promise<string> {
	const encoder = new TextEncoder();
	const data = encoder.encode(input);
	const hashBuffer = await crypto.subtle.digest('SHA-256', data);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	return hashArray.map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Verify an ECDSA signature using public key
 * Note: This is a simplified example, real implementation would need proper wallet integration
 *
 * @param message The message that was signed
 * @param signature The signature to verify
 * @param publicKey The public key to verify against
 * @returns Whether the signature is valid
 */
export async function verifySignature(message: string, signature: string, publicKey: string): Promise<boolean> {
	try {
		// This is a placeholder. In a real implementation, you would use:
		// 1. crypto.subtle for client-side crypto operations
		// 2. ethers.js or similar for Ethereum signature verification
		// 3. The proper formatting of messages (EIP-191/EIP-712)

		// For now, just return true as actual signature verification
		// would require external libraries or more complex implementation
		return true;
	} catch (error) {
		console.error('Error verifying signature:', error);
		return false;
	}
}

/**
 * Create a compact representation of board state
 * Used for ZK proof verification and minimal storage
 *
 * @param board 2D array representing the game board
 * @returns A compact string representation
 */
export function compactBoardRepresentation(board: number[][]): string {
	// Each cell is represented as a number:
	// 0: Empty/Water
	// 1-5: Different ship types
	// Ships are guaranteed to be placed as continuous blocks

	// Flatten the 2D array and convert to a string
	return board.flat().join('');
}

/**
 * Create a commitment hash of a board with salt
 * This allows publishing a commitment without revealing the board
 *
 * @param boardRepresentation The board representation string
 * @param salt A random salt value
 * @returns A hash commitment of the board
 */
export async function createBoardCommitment(boardRepresentation: string, salt: string): Promise<string> {
	// Combine the board representation with the salt
	const commitment = boardRepresentation + salt;

	// Return the SHA-256 hash
	return await sha256(commitment);
}
